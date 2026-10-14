# Chaos Lab

Fill a jar with randomness, and the randomness picks a true fact.

Shake your phone (or move your mouse on a computer). Every tiny, unpredictable wobble becomes a 0 or a 1 that settles into the jar. When the jar is full, those bits choose a fact from 18 subjects, each one checked against a reputable source.

**Live site:** https://parniyapeykamiyan.github.io/chaos-lab/

## How it works

- **Collecting bits.** On phones the page reads the motion sensor (`devicemotion`); on computers it reads mouse movement. If a phone has no motion sensor or permission is declined, you can move your finger around the jar instead. iPhones need a tap on **Begin** to ask for motion permission.
- **Randomness that is never worse than the browser's.** Each sensor reading is hashed into one visible bit. When a fact is chosen, all the raw motion data is hashed with SHA-256 and XOR-ed with 32 bytes from `crypto.getRandomValues()`. XOR-ing anything with independent random bytes stays uniformly random, so the motion can only add unpredictability. The final pick uses rejection sampling, so there's no modulo bias.
- **Half-shaken facts.** Stop moving for about 1.5 seconds and part of the fact appears, in proportion to how full the jar is (nothing below 20%). The rest shows as faint binary. The fact is locked at that moment, so moving again reveals the *same* fact word by word.
- **The reveal.** Only when the jar is completely full: everything goes still, the lights go down, the lid lifts and a soft light appears inside, the bits rise out and drift to where the words will appear, and each word decodes from 0s and 1s into language. Then the subject and source fade in, and finally **Again**, **Save** and **Share**. It takes about 5 seconds; tap anywhere to skip. With `prefers-reduced-motion` it is a simple fade. The partial reveal stays calm, with no dimming.
- **First visit.** The first reveal is preceded by a short explanation of bits and randomness, remembered in `localStorage`. **How it works** opens it any time.
- **Collection.** Press **Save** on a fact to keep it on your device; the collection shows your saved facts with progress per subject. Facts you have already seen are avoided until a subject runs out.
- **Share** copies the fact and the site link (phones use the native share sheet). **Sound** is off by default; when on, there is a quiet low swell as the lights dim and a soft chime when the fact finishes decoding (all synthesised with the Web Audio API).

## Adding facts

All facts live in [`data/facts.json`](data/facts.json):

```json
{ "id": "space-01", "subject": "space", "text": "The Sun holds about 99.8% of all the mass in our solar system.", "source": "https://science.nasa.gov/sun/facts/", "sourceName": "NASA" }
```

- `subject` must match one of the `id`s in the `subjects` list at the top of the file.
- `id` must be unique.
- Please verify every fact against a reputable source (encyclopedias, science agencies, universities, major news) and link it in `source`. Avoid common myths and opinions; keep facts about religion, politics, gender and people neutral and factual.

## Running locally

Plain HTML, CSS and JavaScript with no build step. The facts are loaded with `fetch`, so open it through a local server rather than as a file, for example with the VS Code **Live Server** extension, or:

```bash
npx serve .
```

Motion sensors only work on secure (`https://`) pages, so to test shaking on a real phone use the GitHub Pages site.

## Files

```
index.html        page markup
css/style.css     all styling (light and dark)
js/app.js         states, input, reveal, collection, share
js/entropy.js     entropy pool and seed (SHA-256 XOR crypto.getRandomValues)
js/jar.js         canvas drawing of the bits in the jar
js/flight.js      the bits rising out of the jar during the reveal
js/sound.js       synthesised sound effects
data/facts.json   subjects and sourced facts
```
