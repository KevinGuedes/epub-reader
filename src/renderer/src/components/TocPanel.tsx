import type { NavItem } from 'epubjs'

interface Props {
  items: NavItem[]
  onSelect: (href: string) => void
  onClose: () => void
}

function Items({ items, onSelect, depth }: { items: NavItem[]; onSelect: (href: string) => void; depth: number }): React.JSX.Element {
  return (
    <ul className="toc-list">
      {items.map((item, index) => (
        <li key={`${item.href}-${index}`}>
          <button className="toc-item" style={{ paddingLeft: 12 + depth * 16 }} onClick={() => onSelect(item.href)}>
            {item.label.trim() || '(sem título)'}
          </button>
          {item.subitems && item.subitems.length > 0 && <Items items={item.subitems} onSelect={onSelect} depth={depth + 1} />}
        </li>
      ))}
    </ul>
  )
}

export function TocPanel({ items, onSelect, onClose }: Props): React.JSX.Element {
  return (
    <aside className="drawer drawer-left" aria-label="Índice">
      <header className="drawer-head">
        <h2>Índice</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Fechar">
          ✕
        </button>
      </header>
      <div className="drawer-body">
        {items.length === 0 ? <p className="muted">Este livro não tem índice.</p> : <Items items={items} onSelect={onSelect} depth={0} />}
      </div>
    </aside>
  )
}
