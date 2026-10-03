import { Chess } from 'chess.js'
import type { MoveAnalysis } from '../types'

/**
 * Game tree: every position is a node; `children[0]` is the main continuation and the
 * rest are variations. The app's "current line" (fens / moves / currentIndex) is derived
 * from it: the path from the root to the cursor, then the main continuation onward.
 * All functions are pure and return new objects (safe for React state).
 */
export interface TreeNode {
  id: string
  parentId: string | null
  children: string[]
  fen: string
  /** The move that led here (null for the root). */
  move: MoveAnalysis | null
  comment?: string
  nags?: number[]
}

export type Tree = Record<string, TreeNode>

let seq = 0
const newId = () => `n${++seq}`

export function newTree(fen: string): { tree: Tree; rootId: string } {
  const rootId = newId()
  return { tree: { [rootId]: { id: rootId, parentId: null, children: [], fen, move: null } }, rootId }
}

/** Ids from the root to `id` (inclusive). */
export function pathTo(tree: Tree, id: string): string[] {
  const out: string[] = []
  for (let n: TreeNode | undefined = tree[id]; n; n = n.parentId ? tree[n.parentId] : undefined) out.push(n.id)
  return out.reverse()
}

/** Main continuation after `id` (exclusive), following children[0]. */
export function continuation(tree: Tree, id: string): string[] {
  const out: string[] = []
  for (let n = tree[id]; n?.children.length; n = tree[n.children[0]]) out.push(n.children[0])
  return out
}

/** The full line through `id`: root → id → main continuation. */
export const lineThrough = (tree: Tree, id: string) => [...pathTo(tree, id), ...continuation(tree, id)]

/** True when every step from the root to `id` is a main-line (children[0]) step. */
export function isMainline(tree: Tree, id: string): boolean {
  for (let n = tree[id]; n?.parentId; n = tree[n.parentId]) if (tree[n.parentId].children[0] !== n.id) return false
  return true
}

/** Deepest ancestor of `id` (or `id` itself) that lies on the main line. */
export function mainlineAncestor(tree: Tree, id: string): string {
  const path = pathTo(tree, id)
  let last = path[0]
  for (let i = 1; i < path.length; i++) {
    if (tree[path[i - 1]].children[0] !== path[i]) break
    last = path[i]
  }
  return last
}

/**
 * Adds `move` after `parentId`, reusing an existing child with the same move.
 * The first child becomes the main continuation; later ones are variations.
 */
export function addMove(tree: Tree, parentId: string, move: MoveAnalysis, fen: string): { tree: Tree; id: string } {
  const parent = tree[parentId]
  const existing = parent.children.find((c) => tree[c].move?.uci === move.uci)
  if (existing) return { tree, id: existing }
  const id = newId()
  return {
    id,
    tree: {
      ...tree,
      [parentId]: { ...parent, children: [...parent.children, id] },
      [id]: { id, parentId, children: [], fen, move },
    },
  }
}

/** Makes the line through `id` the main line (moves it to children[0] at every branch). */
export function promoteToMainline(tree: Tree, id: string): Tree {
  const next = { ...tree }
  for (const nodeId of pathTo(tree, id).slice(1)) {
    const parent = next[next[nodeId].parentId!]
    if (parent.children[0] === nodeId) continue
    next[parent.id] = { ...parent, children: [nodeId, ...parent.children.filter((c) => c !== nodeId)] }
  }
  return next
}

/** Removes `id` and everything after it. */
export function deleteSubtree(tree: Tree, id: string): Tree {
  const node = tree[id]
  if (!node?.parentId) return tree
  const next = { ...tree }
  const stack = [id]
  while (stack.length) {
    const cur = stack.pop()!
    stack.push(...next[cur].children)
    delete next[cur]
  }
  const parent = next[node.parentId]
  next[parent.id] = { ...parent, children: parent.children.filter((c) => c !== id) }
  return next
}

/** Replaces the analysis stored on one node. */
export const updateMove = (tree: Tree, id: string, patch: Partial<MoveAnalysis>): Tree =>
  tree[id]?.move ? { ...tree, [id]: { ...tree[id], move: { ...tree[id].move!, ...patch } } } : tree

/** Applies `fn` to every move in the tree (e.g. to mark all analyses stale). */
export function mapMoves(tree: Tree, fn: (m: MoveAnalysis) => MoveAnalysis): Tree {
  const next: Tree = {}
  for (const [id, n] of Object.entries(tree)) next[id] = n.move ? { ...n, move: fn(n.move) } : n
  return next
}

// ─── PGN ──────────────────────────────────────────────────────────────────────

export type MoveFactory = (p: {
  san: string
  uci: string
  color: 'w' | 'b'
  fenBefore: string
  fenAfter: string
}) => MoveAnalysis

const SUFFIX_NAG: Record<string, number> = { '!': 1, '?': 2, '!!': 3, '??': 4, '!?': 5, '?!': 6 }
const TOKEN = /\{[^}]*\}|;[^\n]*|\$\d+|\(|\)|\d+\.+|1-0|0-1|1\/2-1\/2|\*|[^\s(){};$]+/g

/**
 * PGN parser that keeps variations (RAV), comments and NAGs — chess.js keeps only the
 * main line. Illegal or unreadable moves end their branch instead of failing the import.
 */
export function parsePgn(
  text: string,
  makeMove: MoveFactory,
  startFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
): { tree: Tree; rootId: string; headers: Record<string, string> } {
  const headers: Record<string, string> = {}
  const body = text.replace(/^\s*\[(\w+)\s+"((?:[^"\\]|\\.)*)"\]\s*$/gm, (_, k: string, v: string) => {
    headers[k] = v.replace(/\\(.)/g, '$1')
    return ''
  })
  const fen0 = headers.SetUp === '1' && headers.FEN ? headers.FEN : (headers.FEN ?? startFen)
  let { tree, rootId } = newTree(new Chess(fen0).fen())

  let cur = rootId // node the next move is played from
  let last: string | null = null // last move node (target for comments/NAGs)
  let dead = false // branch hit an illegal move: skip until it closes
  const stack: { cur: string; last: string | null; dead: boolean }[] = []

  for (const tok of body.match(TOKEN) ?? []) {
    if (tok === '(') {
      stack.push({ cur, last, dead })
      // A variation replaces the last move: it starts from that move's parent.
      if (last) cur = tree[last].parentId ?? rootId
      continue
    }
    if (tok === ')') {
      const s = stack.pop()
      if (s) ({ cur, last, dead } = s)
      continue
    }
    if (tok.startsWith('{') || tok.startsWith(';')) {
      const comment = tok.startsWith('{') ? tok.slice(1, -1).trim() : tok.slice(1).trim()
      const target = last ?? rootId
      if (comment && tree[target]) {
        const prev = tree[target].comment
        tree = { ...tree, [target]: { ...tree[target], comment: prev ? `${prev} ${comment}` : comment } }
      }
      continue
    }
    if (tok.startsWith('$')) {
      if (last) tree = { ...tree, [last]: { ...tree[last], nags: [...(tree[last].nags ?? []), +tok.slice(1)] } }
      continue
    }
    if (/^\d+\.+$/.test(tok) || /^(1-0|0-1|1\/2-1\/2|\*)$/.test(tok) || dead) continue

    // SAN, possibly with !/? suffixes and 0-0 style castling.
    const m = tok.match(/^(.*?)([!?]{1,2})?$/)!
    const san = m[1].replace(/^0-0-0/, 'O-O-O').replace(/^0-0/, 'O-O')
    const chess = new Chess(tree[cur].fen)
    let played
    try {
      played = chess.move(san)
    } catch {
      played = null
    }
    if (!played) {
      dead = true
      continue
    }
    const fenAfter = chess.fen()
    const move = makeMove({
      san: played.san,
      uci: played.from + played.to + (played.promotion ?? ''),
      color: played.color,
      fenBefore: tree[cur].fen,
      fenAfter,
    })
    const added = addMove(tree, cur, move, fenAfter)
    tree = added.tree
    if (m[2] && SUFFIX_NAG[m[2]]) tree = { ...tree, [added.id]: { ...tree[added.id], nags: [SUFFIX_NAG[m[2]]] } }
    cur = last = added.id
  }
  return { tree, rootId, headers }
}

const fullmove = (fen: string) => parseInt(fen.split(' ')[5] ?? '1', 10) || 1

/** Movetext with variations, comments and NAGs (standard PGN). */
export function treeToMovetext(tree: Tree, rootId: string): string {
  const text = (id: string, forceNumber: boolean) => {
    const n = tree[id]
    const parentFen = tree[n.parentId!].fen
    const num = fullmove(parentFen)
    const white = parentFen.split(' ')[1] === 'w'
    const parts = [white ? `${num}. ${n.move!.san}` : forceNumber ? `${num}... ${n.move!.san}` : n.move!.san]
    for (const nag of n.nags ?? []) parts.push(`$${nag}`)
    if (n.comment) parts.push(`{${n.comment.replace(/[{}]/g, '')}}`)
    return parts.join(' ')
  }
  const line = (fromId: string, forceFirst: boolean): string[] => {
    const out: string[] = []
    let p = fromId
    let force = forceFirst
    while (tree[p].children.length) {
      const [main, ...vars] = tree[p].children
      out.push(text(main, force))
      force = false
      for (const v of vars) {
        out.push(`(${[text(v, true), ...line(v, false)].join(' ')})`)
        force = true // the main line resumes after a variation: repeat the move number
      }
      p = main
    }
    return out
  }
  const root = tree[rootId]
  return [root.comment ? `{${root.comment}}` : '', ...line(rootId, true)].filter(Boolean).join(' ')
}
