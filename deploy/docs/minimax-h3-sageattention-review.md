# MiniMax H3 SageAttention acceleration review

Source reviewed: [MiniMax H3 low-cost deployment guide](https://mp.weixin.qq.com/s/ODnbisZ81nYinpVdJG9GjQ).
The article reports roughly half the generation time after inserting two KJNodes
between the H3 UNet loader and sampler: `Patch Sage Attention KJ` with
`sage_attention=auto`, `allow_compile=true`, followed by
`MiniMax H3 Mem Eff Sage Attention Patch`.  Its examples are from a different
8 GiB GPU, so its timings are not a performance promise for the RTX 3060 host.

## Why it can be faster

The baseline computes attention using full FP16/BF16 query, key, and value
tensors. SageAttention 2.2.0 replaces this hot operation with architecture-aware
kernels. On the RTX 3060 (`sm86`), `auto` selects INT8 query/key attention with
FP16 value tensors. The H3-specific KJNodes patch also frees Q/K/V intermediates
earlier and uses FP32 accumulation in its sm80/sm86 path. This reduces attention
memory traffic and peak VRAM pressure; avoiding offload or paging on a 12 GiB GPU
can contribute as much as the faster kernel itself.

The optimization does not change H3 weights, prompt, seed, 768x416 geometry,
24 fps frame count, scheduler, sampler, or 20 sampling steps. The first request
may be slower because `allow_compile=true` permits compilation; warm requests
are the meaningful speed comparison.

## Image-quality conclusion

SageAttention is a quantized approximation, not a bit-identical implementation.
The same seed can therefore produce a different video. Its upstream project
positions SageAttention 2 as accuracy-preserving and recommends it over newer
lower-precision variants for precision-sensitive work, but the KJNodes H3 patch
is explicitly experimental and has no project-specific blind-quality result for
our model, prompt mix, and RTX 3060.

Expected risk is lower than reducing resolution, frames, or steps because those
quality controls are unchanged. It is nevertheless incorrect to claim zero
degradation before controlled H3 acceptance. Watch especially for identity
drift, small-text/detail loss, motion discontinuities, temporal flicker, and
audio/video timing changes.

## Safe activation gate

- Default remains off: `OSTORY_GPU_H3_SAGE_ATTENTION=0`.
- The Agent requires `h3-sageattention-ready.json`, exact SageAttention 2.2.0,
  RTX 3060 `sm86`, the reviewed KJNodes commit, and live discovery of both node
  types. Any failure automatically keeps the baseline graph.
- The verifier only checks installed dependencies and ComfyUI `/object_info`;
  it never loads H3 or runs inference.
- Installation or production testing requires separate approval after DFS
  acceptance. It must not run during DFS replay or recovery.

## Required A/B acceptance after approval

Use the same input media, prompt, seed, 768x416 size, duration, 24 fps, and 20
steps. Run one cold and at least three warm baseline/accelerated pairs. Record
wall time, sampling time, peak VRAM, host RAM/commit, model-release recovery, and
DFS health. Compare anonymized pairs for identity, prompt adherence, motion,
flicker, fine detail, artifacts, and audio sync.

Do not enable production acceleration unless warm median time improves by at
least 20%, no resource guard or DFS regression occurs, all outputs complete,
and human review finds no systematic quality loss. A failed pair or uncertain
quality result keeps the baseline path.

Reviewed dependency references:

- SageAttention 2.2.0 source commit `d1a57a546c3d395b1ffcbeecc66d81db76f3b4b5`
- ComfyUI-KJNodes commit `6ab7e8130e449ed2c0037589bcf84146ceb7fc9c`
