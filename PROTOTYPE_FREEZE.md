# Prototype Freeze

Status: ACTIVE
Freeze-Date: 2026-07-10
Freeze-Tag (dokumentarisch): prototype-freeze-2026-07-10

## Ziel
Der Prototyp ist funktionsseitig abgeschlossen und wird ab jetzt stabilisiert.

## Scope-Freeze
Nicht mehr erlaubt:
- Neue Features oder neue Views
- Größere Refactorings ohne Fehlerbezug
- Änderungen an Kernmetriken ohne explizite Freigabe

Erlaubt:
- Bugfixes mit klarer Nutzerwirkung
- Kleine UX-Korrekturen (Text, Label, Darstellungsfehler)
- Stabilitätsfixes (Fehlerbehandlung, Time-Window, Chart-Skalen)

## Working Agreement
- Jede Änderung nach Freeze muss in einem kurzen Changelog-Eintrag dokumentiert werden.
- Wenn ein Feature-Wunsch aufkommt, wird er in "Post-Freeze Backlog" gesammelt, aber nicht sofort implementiert.

## Post-Freeze Backlog (erst nach Freigabe)
- Optionaler Login/SSO
- Hardening für Public Production (Rate-Limits, CORS-Restriktion, Admin-Isolation)
- Vollständige CI-Testsuite
