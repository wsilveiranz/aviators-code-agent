interface McpTextContent {
  type: 'text';
  text: string;
}

interface LinkedArticle {
  title: string;
  url: string;
}

interface LinkedInPost {
  url: string;
  author: string;
  authorUrl: string;
  content: string;
  linkedArticle: LinkedArticle | null;
}

export const sampleBlogSnapshot: { content: McpTextContent[] } = {
  content: [{
    type: 'text',
    text: `### Page
- Page URL: https://techcommunity.microsoft.com/category/azure/blog/integrationsonazureblog
- Page Title: Azure Integration Services Blog | Microsoft Community Hub
### Snapshot
\`\`\`yaml
- main [ref=e53]:
  - generic [ref=e58]:
    - article [ref=e61]:
      - heading "Recent Blogs" [level=3] [ref=e63]
      - tabpanel [ref=e64]:
        - generic [ref=e66]:
          - article [ref=e68]:
            - link "Logic Apps Aviators Newsletter - February 2026" [ref=e69] [cursor=pointer]:
              - /url: /blog/integrationsonazureblog/logic-apps-aviators-newsletter---february-2026/4491309
            - text: Feb 02, 2026
          - article [ref=e70]:
            - link "Introducing Unit Test Agent Profiles for Logic Apps & Data Maps" [ref=e71] [cursor=pointer]:
              - /url: /blog/integrationsonazureblog/introducing-unit-test-agent-profiles-for-logic-apps--data-maps/4490216
            - text: Jan 28, 2026
          - article [ref=e72]:
            - link "Automated Test Framework - Missing Tests in Test Explorer" [ref=e73] [cursor=pointer]:
              - /url: /blog/integrationsonazureblog/automated-test-framework---missing-tests-in-test-explorer/4490186
            - text: Jan 28, 2026
          - article [ref=e74]:
            - link "Upcoming Agentic Azure Logic Apps Workshops" [ref=e75] [cursor=pointer]:
              - /url: /blog/integrationsonazureblog/upcoming-agentic-azure-logic-apps-workshops/4489012
            - text: Jan 09, 2026
          - article [ref=e76]:
            - link "Logic Apps Aviators Newsletter - January 2026" [ref=e77] [cursor=pointer]:
              - /url: /blog/integrationsonazureblog/logic-apps-aviators-newsletter---january-2026/4488500
            - text: Jan 05, 2026
          - article [ref=e78]:
            - link "Announcing General Availability of AI & RAG Connectors" [ref=e79] [cursor=pointer]:
              - /url: /blog/integrationsonazureblog/announcing-general-availability-of-ai--rag-connectors/4474337
            - text: Dec 17, 2025
          - article [ref=e80]:
            - link "Microsoft BizTalk Server Product Lifecycle Update" [ref=e81] [cursor=pointer]:
              - /url: /blog/integrationsonazureblog/microsoft-biztalk-server-product-lifecycle-update/4478559
            - text: Dec 08, 2025
\`\`\`
`,
  }],
};

export const sampleAceAviatorEmail = {
  success: true,
  emails: [{
    subject: '[EXTERNAL] Re: Invitation to be February 2026 Ace Aviator of the Month',
    from: 'camilla.bielk@example.com',
    to: 'aviators@microsoft.com',
    date: '2026-01-15T10:30:00Z',
    body: `Hi team,

What's your role and title? What are your responsibilities?
My name is Camilla Bielk, and I am a Senior Integration Architect at Contoso Ltd.

Can you give us some insights into your day-to-day activities?
I design integration platforms, mentor developers, and work with customers on reliable Azure solutions.

What motivates and inspires you to be an active member of the Aviators/Microsoft community?
Sharing practical lessons helps everyone avoid the same pitfalls and build stronger solutions together.

Looking back, what advice do you wish you had been given earlier?
Start simple, use the built-in templates, and do not be afraid to experiment. The community is incredibly helpful, so ask questions and share what you learn.

What has helped you grow professionally?
Curiosity, generous mentors, and teaching other people have helped me grow professionally.

If you had a magic wand that could create a feature in Logic Apps, what would it be?
I would create richer local debugging and replay tools for complex workflows.

LinkedIn profile: https://www.linkedin.com/in/camilla-bielk-0481411

Regards,
Camilla Bielk`,
  }],
};

export const sampleLinkedInPosts: {
  success: true;
  posts: LinkedInPost[];
} = {
  success: true,
  posts: [
    {
      url: 'https://www.linkedin.com/feed/update/urn:li:activity:7421908747347914752/',
      author: 'Devarajan Gurusamy',
      authorUrl: 'https://www.linkedin.com/in/devarajan-gurusamy/',
      content: 'Just published a new article on Azure integrations that actually work in production!',
      linkedArticle: {
        title: 'Azure Integrations That Actually Work in Production',
        url: 'https://www.linkedin.com/pulse/azure-integrations-actually-work-production-devarajan-gurusamy',
      },
    },
    {
      url: 'https://www.linkedin.com/feed/update/urn:li:activity:7420091208464539648/',
      author: 'Stephen Thomas',
      authorUrl: 'https://www.linkedin.com/in/stephenwthomas/',
      content: 'New blog post: Building AI Agent Logic in Logic Apps Consumption.',
      linkedArticle: {
        title: 'Building AI Agent Logic in Logic Apps Consumption',
        url: 'https://www.stephenwthomas.com/azure-integration-thoughts/building-ai-agent-logic-apps-consumption-agent-loop/',
      },
    },
    {
      url: 'https://www.linkedin.com/feed/update/urn:li:activity:7419768336500150273/',
      author: 'Kent Weare',
      authorUrl: 'https://www.linkedin.com/in/kentweare/',
      content: 'Excited to announce upcoming Logic Apps workshops!',
      linkedArticle: null,
    },
  ],
};

export const feb2026DateWindow = {
  month: 'February 2026',
  startDate: '2026-01-06',
  endDate: '2026-02-01',
};
