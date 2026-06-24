# Project Rules & Guidelines

## Deployment Configuration
- Always build Docker images with `--platform linux/amd64` when deploying to the TrueNAS SputnikX server, because the local development environment is a Mac Mini M4 (ARM64).
