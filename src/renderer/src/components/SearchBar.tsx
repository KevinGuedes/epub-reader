import { useEffect, useRef } from 'react'
import { MIN_QUERY_LENGTH } from '../bookSearch'
import type { BookSearch } from '../useBookSearch'

export function SearchBar({ search, focusToken }: { search: BookSearch; focusToken: number }): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)

  // Ctrl+F while the bar is already open selects the text again instead of doing nothing.
  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [focusToken])

  const short = search.query.trim().length < MIN_QUERY_LENGTH
  let status = ''
  if (search.searching) status = 'Buscando…'
  else if (!short && search.total === 0) status = 'Nenhum resultado'
  else if (search.total > 0) status = `${search.current + 1} de ${search.total}${search.truncated ? '+' : ''}`

  return (
    <div className="searchbar" role="search">
      <input
        ref={inputRef}
        type="text"
        value={search.query}
        placeholder="Buscar no livro"
        aria-label="Buscar no livro"
        spellCheck={false}
        onChange={(e) => search.setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            search.step(e.shiftKey ? -1 : 1)
            e.preventDefault()
          } else if (e.key === 'Escape') {
            search.closeBar()
            e.preventDefault()
            e.stopPropagation()
          }
        }}
      />
      <span className="search-status" aria-live="polite">
        {status}
      </span>
      <button className="icon-btn" onClick={() => search.step(-1)} disabled={search.total === 0} aria-label="Resultado anterior" title="Anterior (Shift+Enter)">
        ↑
      </button>
      <button className="icon-btn" onClick={() => search.step(1)} disabled={search.total === 0} aria-label="Próximo resultado" title="Próximo (Enter)">
        ↓
      </button>
      <button className="icon-btn" onClick={search.closeBar} aria-label="Fechar busca" title="Fechar (Esc)">
        ✕
      </button>
    </div>
  )
}
