"""GUI: проверка технического паспорта ОИ на соответствие Приказу ФСТЭК России № 117.

Запуск:  python app.py
"""

import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

from docx import Document

from checker import KIND_TITLES, annotate, check_document, default_output


class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Проверка техпаспорта ОИ — Приказ ФСТЭК России № 117")
        self.geometry("1100x650")
        self.minsize(800, 450)
        self.src: Path | None = None
        self.doc = None
        self.findings = []
        self.show_warnings = tk.BooleanVar(value=True)
        self._build()

    # ------------------------------------------------------------ интерфейс
    def _build(self):
        top = ttk.Frame(self, padding=8)
        top.pack(fill="x")
        ttk.Button(top, text="1. Открыть DOCX…", command=self.open_file).pack(side="left")
        self.path_var = tk.StringVar(value="Файл не выбран")
        ttk.Label(top, textvariable=self.path_var, width=60).pack(side="left", padx=8)
        ttk.Checkbutton(top, text="Показывать рекомендации", variable=self.show_warnings,
                        command=self.refresh).pack(side="left", padx=8)
        self.save_btn = ttk.Button(top, text="2. Сохранить с правками…",
                                   command=self.save, state="disabled")
        self.save_btn.pack(side="right")

        cols = ("n", "level", "kind", "title", "message")
        self.tree = ttk.Treeview(self, columns=cols, show="headings")
        for col, text, width in [("n", "№", 40), ("level", "Уровень", 110),
                                 ("kind", "Тип", 150), ("title", "Раздел", 230),
                                 ("message", "Замечание", 540)]:
            self.tree.heading(col, text=text)
            self.tree.column(col, width=width, anchor="w", stretch=col == "message")
        self.tree.tag_configure("critical", foreground="#C00000")
        self.tree.tag_configure("warning", foreground="#8A5A00")
        scroll = ttk.Scrollbar(self, orient="vertical", command=self.tree.yview)
        self.tree.configure(yscrollcommand=scroll.set)
        self.tree.bind("<<TreeviewSelect>>", self.on_select)

        mid = ttk.Frame(self)
        mid.pack(fill="both", expand=True, padx=8)
        self.tree.pack(in_=mid, side="left", fill="both", expand=True)
        scroll.pack(in_=mid, side="right", fill="y")

        self.details = tk.Text(self, height=8, wrap="word", foreground="#C00000")
        self.details.pack(fill="x", padx=8, pady=(4, 0))
        self.status = tk.StringVar(value="Выберите технический паспорт в формате DOCX")
        ttk.Label(self, textvariable=self.status, padding=6).pack(fill="x")

    # ------------------------------------------------------------ действия
    def open_file(self):
        path = filedialog.askopenfilename(
            title="Технический паспорт объекта информатизации",
            filetypes=[("Документ Word", "*.docx"), ("Все файлы", "*.*")])
        if not path:
            return
        try:
            self.doc = Document(path)
            self.findings = check_document(self.doc)
        except Exception as exc:  # noqa: BLE001 — показываем любую ошибку чтения
            messagebox.showerror("Ошибка", f"Не удалось прочитать файл:\n{exc}")
            return
        self.src = Path(path)
        self.path_var.set(self.src.name)
        self.save_btn.configure(state="normal")
        self.refresh()

    def visible(self):
        return [f for f in self.findings
                if self.show_warnings.get() or f.level == "critical"]

    def refresh(self):
        self.tree.delete(*self.tree.get_children())
        for i, f in enumerate(self.visible(), 1):
            level = "Обязательно" if f.level == "critical" else "Рекомендация"
            self.tree.insert("", "end", iid=str(i - 1), tags=(f.level,),
                             values=(i, level, KIND_TITLES[f.kind], f.title, f.message))
        if self.src:
            crit = sum(f.level == "critical" for f in self.findings)
            self.status.set(f"Замечаний: {len(self.findings)} (обязательных: {crit}). "
                            "Нажмите «Сохранить с правками», чтобы выгрузить DOCX.")

    def on_select(self, _event=None):
        sel = self.tree.selection()
        if not sel:
            return
        f = self.visible()[int(sel[0])]
        text = f"{f.title}\n\n{f.message}"
        if f.ref:
            text += f"\n\nСсылка: {f.ref}"
        if f.context:
            text += f"\n\nФрагмент документа: «{f.context}»"
        self.details.delete("1.0", "end")
        self.details.insert("1.0", text)

    def save(self):
        if not self.src:
            return
        out = filedialog.asksaveasfilename(
            title="Сохранить документ с правками", defaultextension=".docx",
            initialdir=str(self.src.parent), initialfile=default_output(self.src).name,
            filetypes=[("Документ Word", "*.docx")])
        if not out:
            return
        try:
            # Перечитываем исходник, чтобы правки не накладывались при повторном сохранении.
            doc = Document(str(self.src))
            findings = [f for f in check_document(doc)
                        if self.show_warnings.get() or f.level == "critical"]
            annotate(doc, findings, self.src.name)
            doc.save(out)
        except Exception as exc:  # noqa: BLE001
            messagebox.showerror("Ошибка", f"Не удалось сохранить файл:\n{exc}")
            return
        messagebox.showinfo("Готово", f"Файл с правками сохранён:\n{out}")


if __name__ == "__main__":
    App().mainloop()
