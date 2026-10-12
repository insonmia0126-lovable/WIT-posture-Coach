"""상태 전이 테스트를 실행하고 test_results.txt에 기록한다."""

from __future__ import annotations

import unittest
from io import StringIO
from pathlib import Path


def main() -> int:
    stream = StringIO()
    suite = unittest.defaultTestLoader.discover("tests", pattern="test_*.py")
    result = unittest.TextTestRunner(stream=stream, verbosity=2).run(suite)
    text = stream.getvalue()
    summary = (
        f"tests={result.testsRun} failures={len(result.failures)} "
        f"errors={len(result.errors)} skipped={len(result.skipped)}\n"
    )
    out = Path("test_results.txt")
    out.write_text(text + "\n" + summary, encoding="utf-8")
    print(text)
    print(summary)
    print(f"wrote {out.resolve()}")
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    raise SystemExit(main())
