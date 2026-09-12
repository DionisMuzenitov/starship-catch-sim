# Launch / cross-post checklist (SLS-33)

The playbook for taking the project public. **Two rules override everything
below:**

1. **Lead with the playable URL.** People click the play link before reading a
   word. Every post opens with <https://dionismuzenitov.github.io/starship-catch-sim/>.
2. **Be honest about the simplifications.** The strength is a *reproducible
   controls comparison*, not "this is exactly Starship." Never claim fidelity
   the sim doesn't have. Never put the AI/authorship angle in a post title.

> The one-line hook: **"No single controller wins."** A neural policy owns the
> calm corner (96 %); convex MPC is the wind-robust generalist — measured on a
> held-out, domain-randomized benchmark, all in your browser.

---

## Pre-flight (do before posting anything)

- [ ] Demo deploy is green and loads fast on a cold cache (mobile too).
- [ ] README hero GIF renders; **social preview image** set (GitHub → Settings →
      General → Social preview = `apps/web/public/og-image.png`).
- [ ] `og:image` / `twitter:card` verified in a card validator (paste the URL
      into opengraph.xyz or the platform's own debugger).
- [ ] `v1-write-up.md` and the [controller comparison report](../eval/reports/v1-controller-comparison.md)
      are up to date; `pnpm docs:check` green.
- [ ] A `vX.Y` GitHub release exists with the gate records attached (the durable,
      citable pin for the numbers).
- [ ] 60-sec video uploaded (unlisted first), captions checked, linked from README.
- [ ] You have 2–3 hours free *after* posting to answer comments — an unanswered
      launch thread dies.

## Titles per venue (pick, don't reuse verbatim)

**Hacker News** (`news.ycombinator.com` → Show HN)
- `Show HN: Catch a Starship booster in your browser – a PID/MPC/RL benchmark`
- Backup: `Show HN: A 6-DOF Starship-catch simulator that benchmarks four controllers`
- First comment (yours): the honest framing — what it is, what it isn't (§8 of
  the write-up), and "results are pinned in committed gate records; corrections
  welcome as issues." Link the write-up.

**Lobsters** (`lobste.rs`)
- Tags: `programming`, `ml`, `simulation` (add `physics` if it fits; don't
  over-tag). Same title family as HN.

**Reddit** — read each sub's rules first; they differ sharply.
- `r/spacex` — strict, technical, low tolerance for hype. Frame as a *controls
  benchmark / educational sim*, not a game. Flair appropriately. Expect scrutiny
  on vehicle facts — the [catch-provenance page](catch-provenance.md) is your
  citation.
- `r/aerospace` — engineering-first; lead with the 6-DOF + convex-guidance angle.
- `r/MachineLearning` — lead with the honest RL story (direct PPO/SAC failed →
  imitation learning from a privileged teacher; the held-out benchmark; the
  frozen-wind overfitting lesson). This community rewards candour about what
  didn't work.
- General reddit etiquette: **participate, don't drive-by**; no title
  editorializing; reply to every substantive comment; never argue, correct.

**X / Twitter / Mastodon / Bluesky thread template**

```
1/ I built a 6-DOF simulator of SpaceX's Super Heavy *tower catch* — and
   benchmarked four controllers on it. Runs entirely in your browser:
   <URL>  [hero GIF]

2/ The honest headline: no single controller wins.
   A neural policy nails the calm corner (96%). Convex MPC is far more
   wind-robust and overtakes it when conditions get messy. Naïve PID: 0%.
   [progression chart]

3/ Why PID = 0%? It's not a strawman. A tracking loop never solves *when to
   burn* — median miss 3.5–5.5 km. The catch is an ignition-planning problem.

4/ The "RL" policy is imitation-learned, not RL-trained. Direct PPO/SAC never
   caught at laptop compute; I cloned a privileged scripted teacher into an
   observation-only student. That trail (incl. the failures) is public.

5/ Everything's pinned: held-out seeds, Wilson CIs, committed gate records,
   CI-tested TS↔Python physics parity. Play it, break it, file issues:
   <URL>  ·  write-up: <write-up link>
```
- Keep the authorship/AI angle out of the thread title; if asked, answer plainly
  (built solo with heavy AI pair-programming, every decision human-reviewed
  across ~two dozen ADRs including the documented failures).

## Where to post

- [ ] GitHub **release notes** for the launch tag (numbers + seed/config).
- [ ] Personal blog (canonical long-form = the write-up).
- [ ] Hacker News (Show HN) — best Tue–Thu morning US time.
- [ ] Lobsters.
- [ ] r/spacex, r/aerospace, r/MachineLearning — space the posts out; don't
      blast simultaneously.
- [ ] X/Bluesky/Mastodon thread.

## After posting

- [ ] Ask reviewers from social to **file issues for any factual problems** —
      turn scrutiny into a backlog, not an argument.
- [ ] Log notable feedback + any corrections in the SLS-43 decisions log.
- [ ] Triage new issues; label `from-launch`.

---

_Companion to `eval/reports/v1-write-up.md`. Update the hook/numbers here
whenever the benchmark changes._
