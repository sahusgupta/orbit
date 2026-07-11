# Orbit Assistant Setup For TableManager

Use the Orbit assistant from the earlier project to help new contributors onboard and navigate this repository.

## Recommended Sources

The root `orbit.config.json` in this repository is set up with these source groups:

- `onboarding`: curated docs in `docs/`
- `frontend`: React app source in `src/`
- `electron`: desktop runtime in `electron/`
- `api`: API source in `apps/api/src/`
- `api-dashboard`: API dashboard UI in `apps/api/public/`
- `scripts`: build/release/admin scripts in `scripts/`
- `tests`: automated tests in `tests/`
- `root-docs`: root project notes and configs

## Commands

From the Orbit assistant project folder:

```powershell
cd C:\Users\herob\OneDrive\Documents\GitHub\orbit-ai
$env:PYTHONPATH = "src"
python -m orbit_ai --config C:\Users\herob\OneDrive\Documents\GitHub\TableManager\orbit.config.json index
python -m orbit_ai --config C:\Users\herob\OneDrive\Documents\GitHub\TableManager\orbit.config.json status --check-freshness
python -m orbit_ai --config C:\Users\herob\OneDrive\Documents\GitHub\TableManager\orbit.config.json serve --port 8765
```

Then open:

```text
http://127.0.0.1:8765
```

## Suggested Onboarding Prompts

Use these prompts in the Orbit web app:

- Give me a 10-minute tour of this repository.
- What should a new frontend developer read first?
- What should a new backend/API developer read first?
- Explain how local state is saved and loaded.
- Explain how the player mobile app syncs with the management app.
- Where is the waitlist lifecycle implemented?
- Where does Electron talk to the API?
- What files should I change to add a new dashboard metric?
- Which areas are most in need of compact refactoring?
- What generated folders should I ignore while working?

## Source Filtering Ideas

Use source filters when you want narrower answers:

```powershell
python -m orbit_ai --config C:\Users\herob\OneDrive\Documents\GitHub\TableManager\orbit.config.json ask "Where is state saved?" --source electron
python -m orbit_ai --config C:\Users\herob\OneDrive\Documents\GitHub\TableManager\orbit.config.json ask "Where is waitlist sync handled?" --source frontend
python -m orbit_ai --config C:\Users\herob\OneDrive\Documents\GitHub\TableManager\orbit.config.json ask "What API routes exist?" --source api
```

For onboarding, start broad, then filter by source once the contributor knows which area they are in.
