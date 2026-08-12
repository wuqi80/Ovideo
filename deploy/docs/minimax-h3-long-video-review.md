# MiniMax H3 long-video review and guarded integration

Reviewed on 2026-08-12/13. This document records the one-time source review; it is not permission to install, activate, benchmark, or run inference on a production host.

## Reviewed sources

- `NikoDemon80/ComfyUI-H3-Motion-Context`, commit `658ba11ae91737391a247cf9758d0063c43491b3`.
- `AIMixer/ComfyUI_MiniMaxH3_Director`, commit `85863be2411eb1b5877c23414d88396c47838467`.
- Background article supplied by the product owner: `https://mp.weixin.qq.com/s/hQJ3QJ4HJw28WG0aCNY93A`.

The code contract is based on the two repositories. The article was not treated as an executable or versioned specification.

## Chosen architecture

The application exposes **H3 长视频** as a separate option on an already merged card. Each original shot remains a structured Director group with its own prompt, duration, first frame, and optional last frame. One queue task sends the groups to `MiniMaxH3Director`; Director serializes segment generation, enables its built-in Motion Context handoff, trims the duplicated context, and emits one final audio/video result.

Only Director is allowed. Director already contains the Motion Context implementation and explicitly conflicts with the standalone Motion Context pack because both patch the same H3 internals. The verification gate rejects a runtime where standalone Motion Context node IDs are present.

Defaults and hard limits:

- off by default (`MECHA_GPU_H3_LONG_VIDEO=0`);
- 2–8 segments, each 4–15 seconds, total no more than 120 seconds;
- 768×416 at 24 fps;
- 22 video context frames (about 0.92 seconds at 24 fps); the reviewed Motion Context recommendation uses 24 audio context frames internally;
- `clear_vram_between_segments=true` and `export_source_images=false`;
- the existing Sage option remains independent and is used only when its own gate passes;
- missing/mismatched Director marker or nodes fail the long task closed; there is no silent downgrade to one ordinary short clip.

## Quality implications

Motion Context conditions the next segment with the previous segment's final audio/video latent state, so it improves motion, subject-state, camera, ambience, and speech continuity without decoding and re-encoding the handoff. It cannot make contradictory prompts coherent. The next prompt should begin from the previous closing state, keep resolution fixed, and avoid suddenly reintroducing a subject or pose that conflicts with the previous tail.

Long chains are not quality-neutral. The reviewed implementation warns that model smoothing accumulates across segments; audio dulling is usually more visible than picture degradation. Turbo/low-step acceleration can further reduce picture and audio quality. Consequently the UI calls this an experimental mode, the normal H3 path is unchanged, and production activation still requires a separately approved, bounded A/B acceptance run.

## Resolution assessment on the 256 GiB host

The larger host memory materially improves CPU-offload headroom and reduces the risk of Windows commit exhaustion, but it does not increase the RTX 3060's 12 GiB VRAM. Native H3 resolution therefore remains VRAM-bound.

- the guarded production baseline stays at 768×416 (319,488 pixels);
- Director's reviewed default is 864×480 (414,720 pixels), about 1.30 times the current baseline;
- 1024×576 is a possible intermediate acceptance tier, about 1.85 times the baseline;
- an H3 canvas near 720p must use dimensions divisible by 32, so 1280×704 is the aligned candidate rather than 1280×720; it is about 2.82 times the baseline pixel count.

Native 1280×704 is not enabled by this change. The optional **720P 放大** switch uses a serialized two-stage job: generate at the accepted H3 resolution, fully unload H3, pass the host resource gate again, then load the low-VRAM SeedVR2 workflow and export 1280×720. The backend task does not complete until the second stage finishes, so it remains durable if the browser closes. Upscaling can improve edge presentation and delivery resolution but cannot recreate detail absent from the source and can introduce artifacts. A native high-resolution tier remains experimental until an isolated, bounded A/B run records peak VRAM, host private bytes, commit headroom, duration, and visual quality without involving DFS.

## Activation boundary

`windows_gpu_h3_long_video_verify.py` performs metadata-only validation: exact Director commit marker, required live node IDs, and absence of standalone Motion Context nodes. It records `inference_executed: false`. It does not install a node, load a model, claim a task, or prove output quality. Installation, activation, inference, deployment, or a benchmark each require separate explicit approval.
