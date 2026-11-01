# SKILL: Ace Aviator of the Month

## Objective
Extract Q&A from email and generate properly formatted HTML section.

## Inputs
- Month (e.g., "February 2026")
- Email Subject (for inbox search) or Email Body (if pasted)
- Full Name, LinkedIn URL

## Workflow
1. Call getEmailFromMCP(subject, from) to retrieve the email
2. Parse the email body to extract Q&A pairs (YOU must do this, not the skill)
3. Call createAceAviator with the parsed data

## CRITICAL: Email Thread Handling
The email may contain:
- The Ace Aviator's RESPONSE with answers to questions (USE THIS)
- The ORIGINAL invitation email with the questions template (IGNORE THIS)
- Signatures, footers, quoted text (IGNORE THIS)

**Only extract the ANSWERS from the Ace Aviator's response.**
Look for patterns like "On [date] wrote:" or "Den [date] skrev" - everything AFTER that is the original email and should be ignored.

## The 6 Canonical Questions
1. What's your role and title? What are your responsibilities?
2. Can you give us some insights into your day-to-day activities?
3. What motivates and inspires you to be an active member of the Aviators/Microsoft community?
4. Looking back, what advice do you wish you had been given earlier?
5. What has helped you grow professionally?
6. If you had a magic wand that could create a feature in Logic Apps, what would it be?

## Calling createAceAviator
After parsing the email, call createAceAviator with:
```
createAceAviator({
  month: "February 2026",
  name: "Camilla Bielk",
  linkedin: "https://linkedin.com/in/...",
  qaPairs: [
    { question: "What's your role and title?", answer: "I'm a developer and solution architect..." },
    { question: "Can you give us some insights into your day-to-day?", answer: "A typical day starts with..." },
    // ... all 6 Q&A pairs
  ]
})
```

CRITICAL: 
- YOU must parse the email and extract the Q&A pairs
- Pass the qaPairs array to createAceAviator
- Each question/answer must be a separate object in the array
- Do NOT include content from the original invitation email
- Do NOT include email signatures or footers in the answers