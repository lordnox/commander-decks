# Known test failures

## Generated card-handler reload fixture

**Status:** known baseline failure, tracked separately from the Rule DSL work.

**Test:** `live-runner/src/kernelHost.test.ts` — `loads generated card handlers from the current worktree`

**First recorded in this Part 05 follow-up:** 2026-10-10 at
`2026-10-10T07:24:05Z`, on:

```text
Darwin ri-m-1060 25.6.0 Darwin Kernel Version 25.6.0: Fri Jul 31 19:17:26 PDT 2026; root:xnu-12377.161.14~5/RELEASE_ARM64_T6041 arm64
Bun 1.3.14 (bun 1.3.14 (0d9b296a))
```

The failure predates Parts 03–05 and is separate from their DSL changes. The
fixture writes a generated handler with `version: 1`, loads it, rewrites the
same handler with `version: 2`, and expects the second load to observe version
2. It currently fails while importing the temporary generated module.

Reproduce only this test with:

```text
bun test live-runner/src/kernelHost.test.ts --test-name-pattern 'loads generated card handlers from the current worktree'
```

Observed output on the recorded run:

```text
bun test v1.3.14 (0d9b296a)

live-runner/src/kernelHost.test.ts:
error: Cannot find module '/private/var/folders/r3/c0x3yhvx6_n8zc7npz0f_d540000gn/T/kernel-plugins-Dn2iAM/rules-engine/src/cardPlugins/.live-testHandler-68020-2.ts' from ''
(fail) kernel host journal > loads generated card handlers from the current worktree [29.02ms]

 0 pass
 87 filtered out
 1 fail
Ran 1 test across 1 file. [171.00ms]
```

The full host and wire verification command is:

```text
bun test live-runner site/src/liveCompact.test.ts site/src/liveCodec.test.ts
```

On the same run it reported `216 pass`, `1 fail`, and `1008 expect() calls`;
the one failure was this generated-handler fixture with an error of the same
form, pointing into a temporary `kernel-plugins-…` directory. The rules,
interaction, protocol, and browser/headless parity checks passed. The output
does not establish whether the cause is temporary-module naming, cleanup,
resolution, or another fixture/runtime interaction; no root cause is asserted
here. This record is not permission to ignore any new failure in the same or
other tests.
