//! Формат архива .zarc (версия 1).
//!
//! ```text
//! "ZARC" | версия: u8 | метод: u8
//! длина сжатого индекса: u64 LE | сжатый индекс
//! длина сжатых данных: u64 LE   | сжатые данные
//! ```
//!
//! Данные — один сплошной поток уникальных блобов (содержимое файлов без
//! повторов), идущих в порядке индекса. Индекс до сжатия:
//!
//! ```text
//! число блобов: u32, затем для каждого: длина u64, BLAKE3-хеш [u8; 32]
//! число записей: u32, затем для каждой:
//!   вид u8 (0 — файл, 1 — папка), длина пути u16, путь (UTF-8, через '/'),
//!   для файла — номер блоба u32
//! ```

use std::io::{self, Read, Write};

pub const MAGIC: &[u8; 4] = b"ZARC";
pub const VERSION: u8 = 1;
pub const METHOD_XZ: u8 = 1;

pub struct Blob {
    pub len: u64,
    pub hash: [u8; 32],
}

pub enum EntryKind {
    File { blob: u32 },
    Dir,
}

pub struct Entry {
    pub path: String,
    pub kind: EntryKind,
}

pub struct Index {
    pub blobs: Vec<Blob>,
    pub entries: Vec<Entry>,
}

fn invalid(msg: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, msg.to_string())
}

impl Index {
    pub fn encode(&self) -> io::Result<Vec<u8>> {
        let mut out = Vec::new();
        out.extend_from_slice(&u32::try_from(self.blobs.len()).map_err(|_| invalid("слишком много файлов"))?.to_le_bytes());
        for b in &self.blobs {
            out.extend_from_slice(&b.len.to_le_bytes());
            out.extend_from_slice(&b.hash);
        }
        out.extend_from_slice(&u32::try_from(self.entries.len()).map_err(|_| invalid("слишком много файлов"))?.to_le_bytes());
        for e in &self.entries {
            let path_len = u16::try_from(e.path.len()).map_err(|_| invalid("слишком длинный путь"))?;
            match e.kind {
                EntryKind::File { .. } => out.push(0),
                EntryKind::Dir => out.push(1),
            }
            out.extend_from_slice(&path_len.to_le_bytes());
            out.extend_from_slice(e.path.as_bytes());
            if let EntryKind::File { blob } = e.kind {
                out.extend_from_slice(&blob.to_le_bytes());
            }
        }
        Ok(out)
    }

    pub fn decode(mut r: &[u8]) -> io::Result<Index> {
        let blob_count = read_u32(&mut r)?;
        let mut blobs = Vec::new();
        for _ in 0..blob_count {
            let len = read_u64(&mut r)?;
            let mut hash = [0u8; 32];
            r.read_exact(&mut hash)?;
            blobs.push(Blob { len, hash });
        }
        let entry_count = read_u32(&mut r)?;
        let mut entries = Vec::new();
        for _ in 0..entry_count {
            let mut kind = [0u8; 1];
            r.read_exact(&mut kind)?;
            let mut len = [0u8; 2];
            r.read_exact(&mut len)?;
            let mut path = vec![0u8; u16::from_le_bytes(len) as usize];
            r.read_exact(&mut path)?;
            let path = String::from_utf8(path).map_err(|_| invalid("путь не в UTF-8"))?;
            let kind = match kind[0] {
                0 => {
                    let blob = read_u32(&mut r)?;
                    if blob >= blob_count {
                        return Err(invalid("ссылка на несуществующий блоб"));
                    }
                    EntryKind::File { blob }
                }
                1 => EntryKind::Dir,
                _ => return Err(invalid("неизвестный вид записи")),
            };
            entries.push(Entry { path, kind });
        }
        if !r.is_empty() {
            return Err(invalid("лишние байты в индексе"));
        }
        Ok(Index { blobs, entries })
    }
}

pub fn read_u32(r: &mut impl Read) -> io::Result<u32> {
    let mut b = [0u8; 4];
    r.read_exact(&mut b)?;
    Ok(u32::from_le_bytes(b))
}

pub fn read_u64(r: &mut impl Read) -> io::Result<u64> {
    let mut b = [0u8; 8];
    r.read_exact(&mut b)?;
    Ok(u64::from_le_bytes(b))
}

pub fn write_u64(w: &mut impl Write, v: u64) -> io::Result<()> {
    w.write_all(&v.to_le_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn index_round_trip() {
        let index = Index {
            blobs: vec![Blob { len: 42, hash: [7; 32] }],
            entries: vec![
                Entry { path: "папка".into(), kind: EntryKind::Dir },
                Entry { path: "папка/файл.txt".into(), kind: EntryKind::File { blob: 0 } },
            ],
        };
        let decoded = Index::decode(&index.encode().unwrap()).unwrap();
        assert_eq!(decoded.blobs[0].len, 42);
        assert_eq!(decoded.entries[1].path, "папка/файл.txt");
        assert!(matches!(decoded.entries[1].kind, EntryKind::File { blob: 0 }));
    }

    #[test]
    fn decode_rejects_bad_blob_reference() {
        let index = Index {
            blobs: vec![],
            entries: vec![Entry { path: "a".into(), kind: EntryKind::File { blob: 5 } }],
        };
        assert!(Index::decode(&index.encode().unwrap()).is_err());
    }
}
