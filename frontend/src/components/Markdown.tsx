import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/** Render markdown (README / Header from meta) with the site's look.
 * react-markdown escapes raw HTML by default — scripts can't execute. */
export default function Markdown({ children }: { children: string }) {
  return (
    <div className="md-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  )
}
