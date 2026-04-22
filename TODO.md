# TODO

## GitHub Actions CI/CD

Set up a GitHub Actions workflow that triggers on push to `main`:

- Generate a build number (e.g. `YYYYMMDD-<short-sha>`)
- Build a multi-arch Docker image (`linux/amd64` + `linux/arm64`)
- Push to Docker Hub as `emmettmoore/channeler:<build-number>` and `emmettmoore/channeler:latest`
- Use registry-based layer caching to keep builds fast
