mod archive;
mod format;

use std::path::PathBuf;
use std::process::ExitCode;

const USAGE: &str = "\
zarc — архиватор с упором на максимальное сжатие

Использование:
  zarc a <архив.zarc> <файл|папка>...   создать архив
  zarc x <архив.zarc> [папка]           распаковать (по умолчанию в текущую папку)
  zarc l <архив.zarc>                   показать содержимое
";

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let result = match args.first().map(String::as_str) {
        Some("a") if args.len() >= 3 => {
            let inputs: Vec<PathBuf> = args[2..].iter().map(PathBuf::from).collect();
            archive::create(&PathBuf::from(&args[1]), &inputs)
        }
        Some("x") if args.len() == 2 || args.len() == 3 => {
            let out = args.get(2).map_or_else(|| PathBuf::from("."), PathBuf::from);
            archive::extract(&PathBuf::from(&args[1]), &out)
        }
        Some("l") if args.len() == 2 => archive::list(&PathBuf::from(&args[1])),
        _ => {
            eprint!("{USAGE}");
            return ExitCode::from(2);
        }
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("ошибка: {e}");
            ExitCode::FAILURE
        }
    }
}
