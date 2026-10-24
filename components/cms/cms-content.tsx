/**
 * Renders authored CMS content.
 *
 * NO `dangerouslySetInnerHTML`. Admin-authored content is still untrusted input —
 * a compromised or careless admin account must not be able to inject script into
 * every visitor's browser, and a legal page is exactly where someone would try.
 *
 * The stored format is `jsonb` and TASK 016 owns the authoring decision, so this
 * renders the ONE shape that can be relied on today — an array of typed blocks — and
 * ignores anything it does not recognise rather than guessing. An unknown block
 * renders nothing instead of leaking a JSON dump onto a public page.
 */

interface HeadingBlock {
  type: 'heading';
  text: string;
  /** Rendered as h2/h3 only: h1 belongs to the page shell. */
  level?: 2 | 3;
}

interface ParagraphBlock {
  type: 'paragraph';
  text: string;
}

interface ListBlock {
  type: 'list';
  items: string[];
  ordered?: boolean;
}

type ContentBlock = HeadingBlock | ParagraphBlock | ListBlock;

function isBlock(value: unknown): value is ContentBlock {
  if (typeof value !== 'object' || value === null) return false;
  const type = (value as { type?: unknown }).type;

  return type === 'heading' || type === 'paragraph' || type === 'list';
}

/** Narrows the `jsonb` column to the blocks this component can render. */
function toBlocks(content: unknown): ContentBlock[] {
  if (!Array.isArray(content)) return [];
  return content.filter(isBlock);
}

export function CmsContent({ content }: { content: unknown }) {
  const blocks = toBlocks(content);

  if (blocks.length === 0) return null;

  return (
    <div className="flex flex-col gap-4" data-testid="cms-content">
      {blocks.map((block, index) => {
        // Content blocks have no stable ids in the stored format, so the index is
        // the only key available. Safe here: the list is server-rendered and never
        // reordered on the client.
        const key = `${block.type}-${index}`;

        if (block.type === 'heading') {
          return block.level === 3 ? (
            <h3 key={key} className="text-sm font-semibold">
              {block.text}
            </h3>
          ) : (
            <h2 key={key} className="text-base font-semibold">
              {block.text}
            </h2>
          );
        }

        if (block.type === 'paragraph') {
          return (
            <p key={key} className="text-sm leading-relaxed">
              {block.text}
            </p>
          );
        }

        const items = Array.isArray(block.items) ? block.items : [];
        if (items.length === 0) return null;

        return block.ordered ? (
          <ol key={key} className="ml-5 flex list-decimal flex-col gap-1 text-sm">
            {items.map((item, itemIndex) => (
              <li key={`${key}-${itemIndex}`}>{item}</li>
            ))}
          </ol>
        ) : (
          <ul key={key} className="ml-5 flex list-disc flex-col gap-1 text-sm">
            {items.map((item, itemIndex) => (
              <li key={`${key}-${itemIndex}`}>{item}</li>
            ))}
          </ul>
        );
      })}
    </div>
  );
}
