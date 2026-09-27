# Demo video script (W2)

Recorded on `ee036f38` (tag `w2-final`) against the public URL, with an Edge neural voice (en-US-AndrewMultilingualNeural). Browser automation: Playwright at 1280x720. The eval-gate scene replays real gate output captured from `ee036f38` and is labeled as a replay on screen. Synthetic data only.

**s01-title**

Hey, I'm David. This is AgentForge, a clinical co-pilot that lives inside OpenEMR. This is week two, where it learned to read documents.

**s02-landing**

Here's the situation it's built for. A primary care doctor has a follow-up in ten minutes. The chart's in OpenEMR, but the new stuff, a lab report and an intake form the front desk scanned, is sitting in PDFs nobody's read yet. Everything you'll see is synthetic, by the way. No real patients.

**s03-run**

So let's hand it a scanned lab report. When I hit run, a few things happen in order. The PDF gets stored in OpenEMR first, so there's a real document behind every fact. Then OCR reads it, and a supervisor decides what's next. Extract the values. Go find guideline evidence. And then, this part is new, a second model, the critic, checks the answer. It can only take things out. It can never add.

**s04-results**

And here's what comes back. Patient facts and guideline evidence are kept separate, on purpose. Every line cites where it came from: a page in the PDF, or a specific piece of CDC guidance. This A1C is seven point two, which is in the diabetes range, so it raises a safety flag, citing both the lab value and the CDC threshold. And notice this: the critic wasn't fully convinced. But a safety warning shouldn't just quietly disappear, so it stays up, marked for you to go check. Anything the scan itself wasn't sure about goes to needs review.

**s05-source**

And if you don't trust a number, and honestly, you shouldn't, blindly, click the citation. It opens the actual page and highlights the exact spot it read from.

**s06-medlist**

It reads three kinds of documents now. Labs, intake forms, and medication lists. Same deal here. The rows the OCR wasn't confident about aren't stated as fact. They're flagged for a human to check.

**s07-trend**

Add an older lab from June, and you get a trend. That chart isn't drawn from what I just uploaded. It's read back out of OpenEMR. So if the save didn't actually happen, the chart wouldn't either.

**s08-evals**

Now the part I actually care about most. How do I know it didn't quietly get worse? There's a fifty-case golden set, scored pass or fail across five categories: schema, citations, facts, safe refusals, and no patient data in the logs. Plus fifty-four more cases for the new features. If I break something on purpose, like forcing a lab flag to normal, the gate fails, the commit is blocked, and so is the push. A regression can't sneak through.

**s09-obs**

And while it runs, every encounter leaves a trace. Which steps ran, how long each one took, tokens, and cost, which is about six hundredths of a cent per scan. Plus alerts. No names, no document text. Just what you need to actually operate it.

**s10-close**

So that's it. It reads messy documents, it shows its work, it knows when to say, go check this, and it can't slip backwards without the gate catching it. Thanks for watching.
