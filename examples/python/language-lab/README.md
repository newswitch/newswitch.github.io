# Python language lab

CPython 3.14 examples corresponding to `docs/development/python/01-language/`.
The initial verification baseline is CPython 3.14.8 (standard GIL-enabled build).
Only the standard library is required; do not install a web framework for this lab.

## Run

From this directory:

```bash
python execution_demo.py
python execution_demo.py Ada
python references_demo.py
python numbers_demo.py
python text_demo.py
python control_demo.py
python containers_demo.py
python functions_demo.py
python scope_demo.py
python -m lesson_pkg " API "
python -m unittest discover -s tests -v
```

`functions_demo.py` deliberately demonstrates a shared mutable default. Run each
demonstration in a fresh process when comparing the article's expected output.
`scope_demo.broken()` deliberately raises `UnboundLocalError`; its main function
catches the expected error.

For the environment example, create a venv and run it using that interpreter:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe environment_demo.py
.\.venv\Scripts\python.exe -m pip --version
.\.venv\Scripts\python.exe -m pip check
```

On Linux/macOS the executable is `.venv/bin/python`. Activation is optional.
No exercise requires altering system Python or installing packages globally.

## Repository verification

From the repository root:

```bash
node scripts/verify-python-language.mjs
node scripts/verify-python-language.mjs --python /absolute/path/to/python
```

The first command compares the 12 article source blocks with their companion
files and checks 30 exercise answers. The second additionally requires CPython
3.14, creates a temporary venv under `.python-article-checks/`, verifies bundled
pip isolation, compares nine outputs in three fresh processes each, checks CLI
success/failure and silent imports, then runs the unittest suite. It needs no
package download and removes only its own temporary test directory.

`--source-patch` emits an Add File patch for a missing lab, refusing existing
files; it does not silently overwrite hand-edited examples.
