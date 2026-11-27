# Sloth notification branding (1.4.85-ambasa.86)

- Baseline: 35bd4d97bb1df51b9be510b0f8ae737dc8222b8b
- Scope: 13 existing toast emission sites; preserve all messages, severity, return values and options. Prefix extension-specific console emissions; no global toastr override, polling, UI CSS, data or prompt changes.
- Title: 🦥 Lorebook Manager (Korean: 🦥 로어북 매니저).
- Verification: source syntax parsed after stripping imports and substituting import.meta for parser-only validation, emission count and all title sites checked, locale title checks passed. Real SillyTavern desktop/mobile and full repository tests not run in this environment.
- Rollback: revert this commit (previous version 1.4.85-ambasa.85).
