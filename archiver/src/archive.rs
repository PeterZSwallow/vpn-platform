use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{self, BufReader, BufWriter, Read, Seek, SeekFrom, Write};
use std::path::{Component, Path, PathBuf};

use xz2::read::XzDecoder;
use xz2::stream::{Check, Filters, LzmaOptions, Stream};
use xz2::write::XzEncoder;

use crate::format::{self, Blob, Entry, EntryKind, Index};

/// Флаг LZMA_PRESET_EXTREME из liblzma: медленнее, но сжимает сильнее.
const PRESET_EXTREME: u32 = 1 << 31;
/// Предел словаря: распаковка потребует примерно столько же памяти.
const MAX_DICT: u64 = 1 << 30;
/// Защита от «архивных бомб»: индекс больше этого не распаковываем.
const MAX_INDEX: u64 = 1 << 30;

struct Item {
    arc_path: String,
    fs_path: PathBuf,
    is_dir: bool,
}

pub fn create(archive: &Path, inputs: &[PathBuf]) -> io::Result<()> {
    let mut items = Vec::new();
    for input in inputs {
        let name = match input.file_name() {
            Some(n) => n.to_owned(),
            None => fs::canonicalize(input)?
                .file_name()
                .ok_or_else(|| other(format!("не могу определить имя для {}", input.display())))?
                .to_owned(),
        };
        let name = name.to_str().ok_or_else(|| other(format!("имя не в UTF-8: {}", input.display())))?;
        walk(input, name.to_string(), &mut items)?;
    }

    // Не кладём в архив его собственную старую версию.
    if let Ok(own) = fs::canonicalize(archive) {
        items.retain(|it| fs::canonicalize(&it.fs_path).map_or(true, |p| p != own));
    }
    let mut seen = HashSet::new();
    for it in &items {
        if !seen.insert(it.arc_path.as_str()) {
            return Err(other(format!("путь встречается дважды: {}", it.arc_path)));
        }
    }

    // Удаление дубликатов: одинаковое содержимое хранится один раз.
    let mut by_hash: HashMap<[u8; 32], usize> = HashMap::new();
    let mut blobs: Vec<(Blob, usize)> = Vec::new(); // блоб и номер файла-источника
    let mut file_blob: HashMap<usize, usize> = HashMap::new();
    let mut total_in = 0u64;
    for (i, it) in items.iter().enumerate().filter(|(_, it)| !it.is_dir) {
        let (len, hash) = hash_file(&it.fs_path)?;
        total_in += len;
        let b = *by_hash.entry(hash).or_insert_with(|| {
            blobs.push((Blob { len, hash }, i));
            blobs.len() - 1
        });
        file_blob.insert(i, b);
    }

    // Сортировка по типу файла: похожие данные рядом — компрессор находит
    // больше совпадений (как в 7z).
    let mut order: Vec<usize> = (0..blobs.len()).collect();
    order.sort_by_cached_key(|&b| sort_key(&items[blobs[b].1].fs_path, blobs[b].0.len));
    let mut new_id = vec![0u32; blobs.len()];
    for (pos, &b) in order.iter().enumerate() {
        new_id[b] = pos as u32;
    }

    let entries = items
        .iter()
        .enumerate()
        .map(|(i, it)| Entry {
            path: it.arc_path.clone(),
            kind: if it.is_dir { EntryKind::Dir } else { EntryKind::File { blob: new_id[file_blob[&i]] } },
        })
        .collect();
    let unique: u64 = blobs.iter().map(|(b, _)| b.len).sum();
    let sources: Vec<&Path> = order.iter().map(|&b| items[blobs[b].1].fs_path.as_path()).collect();
    let mut ordered_blobs: Vec<Option<Blob>> = blobs.into_iter().map(|(b, _)| Some(b)).collect();
    let index = Index {
        blobs: order.iter().map(|&b| ordered_blobs[b].take().unwrap()).collect(),
        entries,
    };

    let mut out = BufWriter::new(File::create(archive)?);
    out.write_all(format::MAGIC)?;
    out.write_all(&[format::VERSION, format::METHOD_XZ])?;

    let mut enc = XzEncoder::new_stream(Vec::new(), xz_stream(1 << 20)?);
    enc.write_all(&index.encode()?)?;
    let packed_index = enc.finish()?;
    format::write_u64(&mut out, packed_index.len() as u64)?;
    out.write_all(&packed_index)?;

    // Длину данных узнаем только в конце — пока пишем заглушку.
    let len_pos = out.stream_position()?;
    format::write_u64(&mut out, 0)?;
    let mut enc = XzEncoder::new_stream(out, xz_stream(unique)?);
    for (blob, src) in index.blobs.iter().zip(&sources) {
        let mut w = HashWriter::new(&mut enc);
        let copied = io::copy(&mut File::open(src)?.take(blob.len), &mut w)?;
        if copied != blob.len || w.finish() != blob.hash {
            return Err(other(format!("файл изменился во время архивации: {}", src.display())));
        }
    }
    let mut file = enc.finish()?.into_inner().map_err(|e| e.into_error())?;
    let end = file.stream_position()?;
    file.seek(SeekFrom::Start(len_pos))?;
    format::write_u64(&mut file, end - len_pos - 8)?;

    let files = items.iter().filter(|it| !it.is_dir).count();
    println!(
        "файлов: {files}, исходный объём: {total_in} Б, без дубликатов: {unique} Б, архив: {end} Б ({:.2}%)",
        if total_in == 0 { 0.0 } else { end as f64 * 100.0 / total_in as f64 }
    );
    Ok(())
}

pub fn extract(archive: &Path, out_dir: &Path) -> io::Result<()> {
    let (index, data) = open(archive)?;
    let targets: Vec<PathBuf> = index
        .entries
        .iter()
        .map(|e| safe_join(out_dir, &e.path))
        .collect::<io::Result<_>>()?;

    let mut per_blob: Vec<Vec<&Path>> = vec![Vec::new(); index.blobs.len()];
    for (e, target) in index.entries.iter().zip(&targets) {
        match e.kind {
            EntryKind::Dir => fs::create_dir_all(target)?,
            EntryKind::File { blob } => per_blob[blob as usize].push(target),
        }
    }

    let mut data = XzDecoder::new(data);
    for (blob, paths) in index.blobs.iter().zip(&per_blob) {
        let first = paths.first();
        let mut sink: Box<dyn Write> = match first {
            Some(p) => {
                if let Some(parent) = p.parent() {
                    fs::create_dir_all(parent)?;
                }
                Box::new(BufWriter::new(File::create(p)?))
            }
            None => Box::new(io::sink()),
        };
        let mut w = HashWriter::new(&mut sink);
        let copied = io::copy(&mut (&mut data).take(blob.len), &mut w)?;
        if copied != blob.len || w.finish() != blob.hash {
            return Err(other(format!(
                "архив повреждён: {}",
                first.map_or_else(|| "<без имени>".into(), |p| p.display().to_string())
            )));
        }
        sink.flush()?;
        drop(sink);
        for p in paths.iter().skip(1) {
            if let Some(parent) = p.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::copy(first.unwrap(), p)?;
        }
    }
    println!("распаковано записей: {}", index.entries.len());
    Ok(())
}

pub fn list(archive: &Path) -> io::Result<()> {
    let (index, _) = open(archive)?;
    let mut total = 0u64;
    for e in &index.entries {
        match e.kind {
            EntryKind::Dir => println!("{:>14}  {}/", "<папка>", e.path),
            EntryKind::File { blob } => {
                let len = index.blobs[blob as usize].len;
                total += len;
                println!("{len:>14}  {}", e.path);
            }
        }
    }
    let size = fs::metadata(archive)?.len();
    println!("итого: {total} Б в {} записях, архив {size} Б", index.entries.len());
    Ok(())
}

/// Читает заголовок и индекс; возвращает индекс и поток сжатых данных.
fn open(archive: &Path) -> io::Result<(Index, io::Take<BufReader<File>>)> {
    let mut r = BufReader::new(File::open(archive)?);
    let mut head = [0u8; 6];
    r.read_exact(&mut head)?;
    if &head[..4] != format::MAGIC {
        return Err(other("это не архив zarc".into()));
    }
    if head[4] != format::VERSION || head[5] != format::METHOD_XZ {
        return Err(other(format!("неподдерживаемая версия {} / метод {}", head[4], head[5])));
    }
    let index_len = format::read_u64(&mut r)?;
    let mut raw = Vec::new();
    XzDecoder::new((&mut r).take(index_len)).take(MAX_INDEX).read_to_end(&mut raw)?;
    let index = Index::decode(&raw)?;
    let data_len = format::read_u64(&mut r)?;
    Ok((index, r.take(data_len)))
}

fn walk(fs_path: &Path, arc_path: String, out: &mut Vec<Item>) -> io::Result<()> {
    let meta = fs::symlink_metadata(fs_path)?;
    if meta.file_type().is_symlink() {
        eprintln!("пропускаю символическую ссылку: {}", fs_path.display());
        return Ok(());
    }
    if meta.is_dir() {
        out.push(Item { arc_path: arc_path.clone(), fs_path: fs_path.to_owned(), is_dir: true });
        let mut children: Vec<_> = fs::read_dir(fs_path)?.collect::<io::Result<_>>()?;
        children.sort_by_key(|c| c.file_name());
        for c in children {
            let name = c.file_name();
            let name = name.to_str().ok_or_else(|| other(format!("имя не в UTF-8: {}", c.path().display())))?;
            walk(&c.path(), format!("{arc_path}/{name}"), out)?;
        }
    } else if meta.is_file() {
        out.push(Item { arc_path, fs_path: fs_path.to_owned(), is_dir: false });
    } else {
        eprintln!("пропускаю особый файл: {}", fs_path.display());
    }
    Ok(())
}

/// Путь внутри архива превращается в путь на диске только если он не может
/// выйти за пределы папки распаковки (защита от "../../etc/passwd").
fn safe_join(base: &Path, arc_path: &str) -> io::Result<PathBuf> {
    let rel = Path::new(arc_path);
    let ok = arc_path
        .split('/')
        .all(|seg| !seg.is_empty() && seg != "." && seg != ".." && !seg.contains(['\\', '\0']))
        && rel.components().all(|c| matches!(c, Component::Normal(_)));
    if !ok {
        return Err(other(format!("опасный путь в архиве: {arc_path:?}")));
    }
    Ok(base.join(rel))
}

fn sort_key(path: &Path, len: u64) -> (String, String, u64) {
    let lower = |s: Option<&std::ffi::OsStr>| s.and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
    (lower(path.extension()), lower(path.file_name()), len)
}

fn xz_stream(data_len: u64) -> io::Result<Stream> {
    let mut opts = LzmaOptions::new_preset(9 | PRESET_EXTREME).map_err(io::Error::from)?;
    // Словарь не больше самих данных: та же степень сжатия, меньше памяти.
    let dict = data_len.clamp(1 << 16, MAX_DICT).next_power_of_two().min(MAX_DICT);
    opts.dict_size(dict as u32).nice_len(273);
    let mut filters = Filters::new();
    filters.lzma2(&opts);
    Stream::new_stream_encoder(&filters, Check::None).map_err(io::Error::from)
}

fn hash_file(path: &Path) -> io::Result<(u64, [u8; 32])> {
    let mut w = HashWriter::new(io::sink());
    let len = io::copy(&mut File::open(path)?, &mut w)?;
    Ok((len, w.finish()))
}

struct HashWriter<W> {
    inner: W,
    hasher: blake3::Hasher,
}

impl<W: Write> HashWriter<W> {
    fn new(inner: W) -> Self {
        HashWriter { inner, hasher: blake3::Hasher::new() }
    }

    fn finish(&self) -> [u8; 32] {
        *self.hasher.finalize().as_bytes()
    }
}

impl<W: Write> Write for HashWriter<W> {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        let n = self.inner.write(buf)?;
        self.hasher.update(&buf[..n]);
        Ok(n)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.inner.flush()
    }
}

fn other(msg: String) -> io::Error {
    io::Error::other(msg)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn safe_join_rejects_escapes() {
        let base = Path::new("/out");
        assert_eq!(safe_join(base, "a/b.txt").unwrap(), Path::new("/out/a/b.txt"));
        for bad in ["", "../x", "a/../../x", "/etc/passwd", "a/./b", "a\\..\\b"] {
            assert!(safe_join(base, bad).is_err(), "{bad:?} должен быть отклонён");
        }
    }
}
