# 3-minute video demonstration outline

Prep (off camera): `npm run demo:media`, `npm run dev`, open http://localhost:3000. Optional: `npm run demo` once beforehand so
"Scripted demo runs" in Insights is not empty (say clearly that it is scripted). Use Mock mode, so there is no API spend.

| Time | Screen | Say / do |
| --- | --- | --- |
| 0:00–0:15 | Header, Source step | Problem: one source video, many ad variations, slow manual work. The baseline of 180 designer-minutes per accepted variation is a *reference*; the targets (≤86, ≤58) are *goals*, not results. Everything is local. |
| 0:15–0:40 | Source | Upload `demo/sample-source.mp4` (synthetic, generated locally, no third-party footage). Paste the sample script, product, CTA. Pick the 6–8 s segment; show framing Fit vs Fill. |
| 0:40–1:05 | Variations | Three angles. Edit one hook by hand. Note the Mock badge: free, offline; Gemini is optional and validated against invented claims. Click *Create 3 videos*. |
| 1:05–1:35 | Review | Progress while rendering. Play variation 1; click Hook / Demo / CTA to jump; Space to pause. Point out Download is locked until you accept. **Accept** 1 and 2, **Reject** 3. |
| 1:35–2:00 | Recovery | Edit variation 3's hook → its video becomes *Outdated*. "Re-render 1 changed video": only that one re-renders. Accept it. Download an accepted MP4; `ffprobe` it in a terminal (h264, 720x1280, 10 s). |
| 2:00–2:15 | Finish | *Finish session*. Stress: generating ideas never counted; only accepted, up-to-date videos do. |
| 2:15–2:45 | Insights → Measured | Accepted count, human time per accepted, first-pass rate, render time/failure rate, estimated AI cost, hands-on vs waiting. Targets table: measured value is one session, in-tool only, so indicative. Download sessions CSV. Show the *Show* selector: scripted runs are separate. |
| 2:45–3:00 | Insights → Business scenarios | Different styling and a **Forecast** badge: assumptions, not measurements. Change an input; show net incremental EGP and break-even ROMI, including a negative case. Close with limitations and the next iteration (outcome data + a proper time study). |
