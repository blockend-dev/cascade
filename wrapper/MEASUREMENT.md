# Wrapper measurement & verification runbook

This is the procedure ADR 0011 refers to as "what a `CascadeWrapper`
`ProviderMode` decision should actually be based on." It replaces "the
contract owner flipped a flag" with "the contract owner followed this
checklist, and anyone can redo it." It does not, and cannot, make
`ExecutionRegistry.setProviderMode` cryptographically self-verifying —
that remains explicitly out of scope (ADR 0011, prior research). What it
does is make the owner's decision auditable and falsifiable.

## What "the wrapper's measurement" means

A TEE attestation (via Dstack or an equivalent Intel TDX deployment path)
covers the measured launch configuration — for a Dstack-style deployment,
this includes a hash over the `docker-compose.yml` and the referenced
image digests (0G's own documentation describes exactly this check —
"Docker Compose hash verification (calculated vs. event log)"). Two
things must match for a deployment to be "the Cascade wrapper" in any
meaningful sense:

1. The **image digest** referenced in the deployed `docker-compose.yml`
   matches an image actually built from this repository's `Dockerfile` at
   a specific, tagged commit.
2. The **docker-compose configuration** itself matches
   `docker-compose.example.yml` (or a documented, reviewed variant of it)
   — not a modified compose file that, say, mounts a different entrypoint.

## Reproducing the build

```
git checkout <tagged release commit>
docker build -t cascade-wrapper:<tag> wrapper/
docker inspect --format='{{index .RepoDigests 0}}' cascade-wrapper:<tag>
```

Because the base image is pinned by digest (`wrapper/Dockerfile`) and
dependencies are pinned via the committed `package-lock.json` (`npm ci`,
never `npm install` or `npm update`, in the Dockerfile), two independent
builds from the same commit should produce byte-identical application
layers. Docker layer hashes for the base OS layers are already fixed by
the pinned digest; only the `npm ci` and `tsc` output layers depend on
this repository's own content, which is exactly what should be
reproducible.

**Known limitation, disclosed rather than assumed away**: full
bit-for-bit reproducibility across different host architectures, Docker
versions, or npm registry states over time is not independently verified
by this repository — it is the standard, documented goal of pinned-digest
+ pinned-lockfile builds, not a guarantee this project has separately
tested end to end. Treat "reproducible" here as "as reproducible as a
pinned Dockerfile and lockfile make it," not as an audited property.

## Verifying a live provider's attestation against this measurement

0G's own documentation points to `dstack-verifier` and `sigstore` for
manual attestation verification (confirmed from `docs.0g.ai`'s inference
documentation, prior research). This project does not reimplement either
— it reuses them:

1. Obtain the provider's attestation report (via the manual verification
   path 0G's own documentation describes).
2. Confirm the CPU/GPU attestation is genuine (hardware root of trust —
   `dstack-verifier` or equivalent).
3. Confirm the measured docker-compose hash in the attestation matches
   the hash of `docker-compose.example.yml` (or the specific reviewed
   variant actually deployed).
4. Confirm the image digest referenced in that compose file matches a
   digest reproduced per "Reproducing the build" above.

If all four hold, the provider is plausibly running the actual Cascade
wrapper, not an image merely claiming to. If any step fails or cannot be
completed, `ProviderMode` should not be set to `CascadeWrapper` for that
provider — and if it already is, that's exactly the situation
`docs/threat-model.md`'s "Resolver" limitation (ADR 0006) exists to name
honestly rather than hide.

## What this procedure does not establish

Everything already disclosed in `docs/trust-model.md` and ADR 0011 still
applies: this is an off-chain-verified, on-chain-registered claim, not a
cryptographic proof enforced by any contract. A malicious operator who
successfully substitutes a different image after this check was last
performed would not be caught until the next re-check. Continuous
re-attestation (catching a post-check substitution automatically) is
explicitly future work — see `docs/threat-model.md` #20 and the original
Cascade research's "Continuous Model Integrity Audit Network" candidate,
not built here.
