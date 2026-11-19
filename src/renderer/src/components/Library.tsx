import { useCallback, useEffect, useMemo, useState } from 'react'
import type { BookSummary, ScanOutcome, ScanProgress } from '../../../shared/types'
import { useStore } from '../store'
import { useDismissOutside } from '../useDismissOutside'
import { SettingsPanel } from './SettingsPanel'
import { TopbarActions } from './TopbarActions'
import { useFullscreen } from '../useFullscreen'

type SortKey = 'recent' | 'title' | 'author' | 'added'

const SORT_LABELS: Record<SortKey, string> = {
  recent: 'Lidos recentemente',
  title: 'Título',
  author: 'Autor',
  added: 'Adicionados recentemente'
}

function sortBooks(books: BookSummary[], key: SortKey): BookSummary[] {
  const byText = (a: string | null, b: string | null): number => (a ?? '').localeCompare(b ?? '', 'pt-BR', { sensitivity: 'base' })
  const copy = [...books]
  switch (key) {
    case 'title':
      return copy.sort((a, b) => byText(a.title, b.title))
    case 'author':
      return copy.sort((a, b) => byText(a.author, b.author) || byText(a.title, b.title))
    case 'added':
      return copy.sort((a, b) => b.addedAt - a.addedAt)
    case 'recent':
      return copy.sort((a, b) => (b.lastReadAt ?? 0) - (a.lastReadAt ?? 0) || byText(a.title, b.title))
  }
}

function describeFailure(outcome: Extract<ScanOutcome, { ok: false }>): string {
  switch (outcome.reason) {
    case 'folder-unavailable':
      return 'A pasta não está acessível (renomeada, removida ou disco desmontado). Seus livros e progresso foram mantidos.'
    case 'no-folder':
      return 'Nenhuma pasta selecionada.'
    default:
      return `Não foi possível ler a pasta${outcome.message ? `: ${outcome.message}` : '.'}`
  }
}

export function Library(): React.JSX.Element {
  const openBook = useStore((s) => s.openBook)

  const [dir, setDir] = useState<string | null | undefined>(undefined) // undefined = still loading
  const [books, setBooks] = useState<BookSummary[]>([])
  const [progress, setProgress] = useState<ScanProgress | null>(null)
  const [scanning, setScanning] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('recent')
  const [showSettings, setShowSettings] = useState(false)
  const { fullscreen, toggleFullscreen } = useFullscreen()
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'F11') {
        toggleFullscreen()
        e.preventDefault()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleFullscreen])
  const closeSettings = useCallback(() => setShowSettings(false), [])
  useDismissOutside(showSettings, closeSettings)

  const refresh = useCallback(async () => {
    setBooks(await window.api.listBooks())
  }, [])

  const runScan = useCallback(async () => {
    setScanning(true)
    setNotice(null)
    try {
      const outcome = await window.api.scanLibrary()
      if (!outcome.ok) {
        if (outcome.reason !== 'no-folder') setNotice(describeFailure(outcome))
      } else if (outcome.result.unreadable > 0) {
        setNotice(`${outcome.result.unreadable} arquivo(s) não puderam ser lidos por completo e aparecem pelo nome do arquivo.`)
      }
    } finally {
      setScanning(false)
      setProgress(null)
      await refresh()
    }
  }, [refresh])

  useEffect(() => {
    const off = window.api.onScanProgress(setProgress)
    void (async () => {
      const current = await window.api.getLibraryDir()
      setDir(current)
      await refresh() // show what is already indexed immediately
      if (current) await runScan()
    })()
    return off
  }, [refresh, runScan])

  const chooseDir = useCallback(async () => {
    const chosen = await window.api.chooseLibraryDir()
    if (!chosen) return
    setDir(chosen)
    await runScan()
  }, [runScan])

  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('pt-BR')
    const filtered = q
      ? books.filter((b) => `${b.title} ${b.author ?? ''}`.toLocaleLowerCase('pt-BR').includes(q))
      : books
    return sortBooks(filtered, sort)
  }, [books, query, sort])

  if (dir === undefined) return <div className="screen" />

  return (
    <div className="screen">
      <header className="topbar">
        <h1 className="app-title">Biblioteca</h1>
        <input
          type="search"
          className="search"
          placeholder="Buscar por título ou autor"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={books.length === 0}
        />
        <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Ordenar por">
          {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
            <option key={key} value={key}>
              {SORT_LABELS[key]}
            </option>
          ))}
        </select>
        <TopbarActions
          onToggleSettings={() => setShowSettings((v) => !v)}
          fullscreen={fullscreen}
          onToggleFullscreen={toggleFullscreen}
        />
      </header>

      {dir && (
        <div className="subbar">
          <span className="path" title={dir}>
            {dir}
          </span>
          <button className="link-btn" onClick={() => void chooseDir()}>
            Alterar pasta
          </button>
          <button className="link-btn" onClick={() => void runScan()} disabled={scanning}>
            {scanning ? 'Atualizando…' : 'Atualizar'}
          </button>
          {scanning && progress && progress.phase === 'indexing' && progress.total > 0 && (
            <span className="muted">
              {progress.done}/{progress.total}
            </span>
          )}
        </div>
      )}

      {notice && <div className="notice">{notice}</div>}

      {!dir ? (
        <div className="empty">
          <h2>Escolha a pasta dos seus livros</h2>
          <p className="muted">Todos os arquivos .epub dentro dela (inclusive em subpastas) aparecerão aqui.</p>
          <button className="primary-btn" onClick={() => void chooseDir()}>
            Escolher pasta…
          </button>
        </div>
      ) : books.length === 0 ? (
        <div className="empty">
          <p className="muted">{scanning ? 'Procurando livros…' : 'Nenhum arquivo .epub encontrado nessa pasta.'}</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="empty">
          <p className="muted">Nenhum livro corresponde à busca.</p>
        </div>
      ) : (
        <main className="grid">
          {visible.map((book) => (
            <button key={book.id} className="card" onClick={() => openBook(book.id)} title={book.title}>
              <div className="cover">
                {book.hasCover ? (
                  <img src={`cover://book/${book.id}`} alt="" loading="lazy" draggable={false} />
                ) : (
                  <div className="cover-fallback">{book.title.slice(0, 1).toUpperCase()}</div>
                )}
              </div>
              <div className="card-title">{book.title}</div>
              <div className="card-author">{book.author ?? 'Autor desconhecido'}</div>
              <div className="bar" aria-hidden>
                <div className="bar-fill" style={{ width: `${Math.round(book.percent * 100)}%` }} />
              </div>
              <div className="card-meta">{book.percent > 0 ? `${Math.round(book.percent * 100)}% lido` : 'Não iniciado'}</div>
            </button>
          ))}
        </main>
      )}

      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
    </div>
  )
}
