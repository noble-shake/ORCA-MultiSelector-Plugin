# Agent guide

This repository is a Claude Code plugin: a lead-agent skill (`skills/orca-multiselector/`) and a local board app (`app/`).
How the plugin is used is in `README.md`; the lead's procedure is in the skill.

## Rules for changes

- The board is read-only. It may call only `orca orchestration worker-list` and `worker-read`
  (`app/lib/orca.js` `READ_ONLY`). Never add `orchestration check` or any command that changes Orca state.
- Node.js 22+ built-in modules only. No runtime dependencies, no `npm install`.
- The server binds `127.0.0.1`, accepts GET/HEAD only, checks the Host header, and never serves files outside
  `<work>/<run>/<worker>/`. Keep the content security policy strict; the page builds DOM with `textContent` only.
- `options.json` / `question.json` are the contract with workers. Changing them means bumping `version`, updating
  `README.md`, the skill's output contract block, `app/lib/workdir.js`, and the tests together.
- `app/public/format.js` is shared by the browser and the tests; keep it dependency-free.
- Do not commit personal paths, user names, or project-specific content. Examples stay generic.

## Checks

```text
npm test                     # node --test, uses tests/fixtures/fake-orca.js instead of a real Orca
npm run demo                 # board with sample workers, no Orca needed
claude plugin validate .     # plugin and marketplace manifests
```
