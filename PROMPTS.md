# Demo Prompts — Blackwell Bank MCP App

Use these prompts with any AI assistant connected to `https://garry-demo.meaburn.com/mcp` (HTTP) or configured for stdio (Claude Desktop). Prompts don't need to be exact — the model matches intent.

---

## Scenario 1 — Full Sales UI

Opens the complete panel: card catalogue on the left, card detail on the right, eligibility form and application stepper below.

**Prompt to open:**
> Show me Blackwell Bank credit cards

**Variations:**
> What credit cards does Blackwell Bank offer?

> I'm looking for a new credit card — what does Blackwell Bank have?

> Can you show me Blackwell Bank's card products?

**What to do next in the UI:**
- Click between cards in the left column to switch the detail view (card selection is an app-only tool — the model never sees it)
- Fill in the eligibility form (credit band, income, employment status) and click **Check your eligibility**
- Click **Continue to application** after the eligibility result appears
- Work through the 5-step application form and submit — the model receives a notification when done
- Click **⤢** (top-right of any panel) to expand to fullscreen

---

## Scenario 2 — Card Detail Fragment

Opens a focused single-card spotlight with features, APR, and a CTA. No navigation chrome.

**Prompt:**
> Tell me about the Blackwell Rewards Card

**Variations:**
> What are the benefits of the Blackwell Rewards Card?

> Show me the Blackwell Cashback Card details

> I want to see the features of the Blackwell Rewards Card

> What's the APR on the Blackwell Cashback Card?

**What to do next in the UI:**
- Click **Check your eligibility** to trigger the eligibility tool from inside the fragment

---

## Scenario 3 — Eligibility Widget Fragment

Runs a soft eligibility check and shows the pre-qualification result — green success box, credit limit, and APR stats.

**Prompt:**
> Check if I'm eligible for the Blackwell Cashback Card

**Variations:**
> Am I likely to be approved for a Blackwell Bank card?

> Can you do an eligibility check for the Rewards Card?

> I want to see if I'd qualify for the Blackwell Cashback Card

> Check my eligibility — I earn £35,000 and have good credit

**What to do next in the UI:**
- Click **Continue to application** to switch to the application stepper

---

## Scenario 4 — Application Stepper Fragment

Launches the 5-step application form: Personal details → Address → Employment → Review → Decision.

**Prompt:**
> Apply for the Blackwell Rewards Card

**Variations:**
> I'd like to apply for the Blackwell Cashback Card

> Start a credit card application for the Rewards Card

> Begin my application for a Blackwell Bank card

> I want to apply — I'm an existing customer

**What to do next in the UI:**
- Fill in the form fields and click **Continue** to progress through steps
- Click **Save and exit** to bail out without submitting
- On the final step, submit — a confirmation screen with animated check appears and the model is notified

---

## Multi-turn conversation flows

These show how to chain scenarios naturally in a single conversation.

### Flow A — discovery to application

> Show me Blackwell Bank credit cards

*(Browse the catalogue, click cards to compare)*

> Tell me more about the cashback option

> What would my eligibility look like with a £28,000 salary and fair credit?

> OK let's apply for the cashback card

---

### Flow B — targeted eligibility then apply

> I earn £45,000 a year, good credit score — which Blackwell Bank card would suit me?

> Check my eligibility for the Rewards Card

> Great, let's start the application

---

### Flow C — existing customer journey

> I'm already a Blackwell Bank customer — what new cards can I get?

> Show me the Rewards Card details

> Apply for it — I'm an existing customer

---

### Flow D — fragment-first then expand

> What's the APR on the Blackwell Rewards Card?

*(Card detail fragment appears)*

> Run an eligibility check for that card

*(Eligibility widget appears)*

> Now show me everything — the full card comparison

*(Full UI opens)*

---

## Things to click during a live demo

| Action | Where | What it shows |
|---|---|---|
| Switch cards | Card list (left column, full view) | App-only tool — model never involved |
| Check eligibility | Eligibility form (bottom-left, full view) | Green result box with credit limit |
| Continue to application | Eligibility result CTA | Switches to stepper |
| Save and exit | Form footer (left link) | Exits without submitting |
| Continue | Form footer (right button) | Steps through the form |
| Submit application | Final review step | Confirmation + sparkle animation + model notified |
| ⤢ Expand | Top-right of any panel | Fullscreen mode |

---

## Tips for a live audience demo

- **Start with Scenario 1** — the full UI is the most impressive opening and gives a complete picture in one shot
- **Switch cards during the live view** to show app-only tools: the model isn't called but the UI updates instantly
- **Fill in the eligibility form** yourself during the demo — it shows the interactive UI working in real time
- **Submit the application** to trigger the `sendMessage` call — the model will respond in the chat after the confirmation screen appears
- **Use the expand button** to demonstrate `requestDisplayMode` — the panel goes fullscreen and back
- **Show the fragment scenarios separately** (Scenarios 2–4) to demonstrate that the same server delivers both full UIs and targeted widgets depending on what the model asks for
- **Switch between ChatGPT and Claude** using the same endpoint (`https://garry-demo.meaburn.com/mcp`) to show transport compatibility
