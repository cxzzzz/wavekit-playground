<script setup lang="ts">
import { EditorState } from '@codemirror/state'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { python } from '@codemirror/lang-python'
import { EditorView, keymap, lineNumbers } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string]; run: [] }>()
const host = ref<HTMLElement | null>(null)
let view: EditorView | null = null

onMounted(() => {
  view = new EditorView({
    state: EditorState.create({
      doc: props.modelValue,
      extensions: [
        python(),
        syntaxHighlighting(HighlightStyle.define([
          { tag: tags.keyword, color: '#bb9dff' },
          { tag: [tags.name, tags.variableName], color: '#dce8ea' },
          { tag: [tags.function(tags.variableName), tags.definition(tags.variableName)], color: '#78d5d6' },
          { tag: [tags.string, tags.special(tags.string)], color: '#d8c579' },
          { tag: [tags.number, tags.bool, tags.null], color: '#f0a879' },
          { tag: tags.comment, color: '#71878b', fontStyle: 'italic' },
          { tag: [tags.operatorKeyword, tags.operator], color: '#a9b9bb' },
          { tag: tags.punctuation, color: '#a9b9bb' },
        ])),
        lineNumbers(),
        EditorView.lineWrapping,
        keymap.of([{ key: 'Mod-Enter', run: () => { emit('run'); return true } }]),
        EditorView.updateListener.of(update => {
          if (update.docChanged) emit('update:modelValue', update.state.doc.toString())
        }),
      ],
    }),
    parent: host.value!,
  })
})

watch(() => props.modelValue, value => {
  if (!view || value === view.state.doc.toString()) return
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } })
})

onBeforeUnmount(() => view?.destroy())
</script>

<template><div ref="host" class="editor" /></template>

<style>
.editor, .editor .cm-editor { height: 100%; }
.editor .cm-editor { background: var(--canvas); color: #dce8ea; font: 12px/1.65 var(--mono); outline: 0; }
.editor .cm-scroller { overflow: auto; padding: 13px 0; }
.editor .cm-content { caret-color: #62c8bf; padding: 0 14px; }
.editor .cm-cursor { border-left-color: #62c8bf; }
.editor .cm-selectionBackground { background: #214b48 !important; }
.editor .cm-gutters { background: var(--canvas); border-right: 1px solid var(--line); color: #52676d; }
.editor .cm-activeLineGutter { background: var(--surface-hover); color: #8fa5aa; }
</style>
