# Security Policy

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Contact the repository
maintainers privately and include the affected revision, reproduction steps,
impact, and any suggested mitigation. Do not include production credentials or
personal data in the report.

## Credential handling

- Configure provider keys, database passwords, signing secrets, and worker tokens
  through environment variables or an external secret manager.
- Example files must contain placeholders that cannot authenticate.
- Rotate a credential immediately if it is committed, logged, or shared in a
  public artifact. Deleting it from the latest revision is not sufficient; the
  repository history must also be cleaned before publication.

## Supported releases

Security fixes target the current `main` branch until a formal release policy is
published.
