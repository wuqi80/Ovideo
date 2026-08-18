# Video credit pricing

Effective pricing version: `2026-08-19-video-cost-v2`.

## Rules

- Local processing-cluster video workflows cost 10 credits per successful task.
- The optional local MiniMax H3 720P post-upscale adds 5 credits, for 15 credits total.
- External APIs use 20 credits per CNY of provider cost, rounded to the nearest whole credit.
- Resolution, duration, audio/reference-video options and provider sub-models are taken from the persisted server task payload.
- Browser-supplied `price` or `credits` fields are ignored.
- Credits are reserved before queue admission, settled once after success, and released after final failure or cancellation.

## Default examples

| Model/profile | Default specification | Credits |
| --- | --- | ---: |
| Local MiniMax H3 / Wan / processing-cluster workflow | one task | 10 |
| Local MiniMax H3 with 720P post-upscale | one task | 15 |
| MiniMax Hailuo 2.3 | 768P, 6s | 40 |
| Seedance 2 Mini | 720P, 5s | 50 |
| Kling v3 | 720P, 5s, no audio/reference video | 60 |
| Vidu q3 reference | 720P, 5s | 63 |
| Seedance 2 Fast | 720P, 5s | 75 |
| Seedance 2 standard | 720P, 5s | 95 |
| Wan 2.6 | 1080P, 5s | 100 |
| Veo 3.1 Fast gateway tier | one default request | 110 |
| Sora 2 gateway tier | one 15s request | 120 |
| HappyHorse 1.0 | 720P, 5s | 90 |
| HappyHorse 1.0 | 1080P, 5s | 160 |

Actual task cost can differ from the examples when the user changes duration,
resolution, audio/reference options, or provider sub-model.

## Provider price references

- Alibaba Cloud Model Studio model pricing (HappyHorse, Kling, Vidu, Wan):
  <https://help.aliyun.com/zh/model-studio/model-pricing>
- MiniMax pay-as-you-go pricing:
  <https://platform.minimaxi.com/docs/guides/pricing-paygo>
- Volcengine Seedance product and token package:
  <https://www.volcengine.com/activity/seedance2>

Provider prices are time-sensitive. When a provider changes its public rate,
update `services/video_credit_pricing.py`, its pricing version, this table, and
the regression tests in the same release.
