import {EditorView} from '@codemirror/view';
import {HighlightStyle,syntaxHighlighting} from '@codemirror/language';
import {tags} from '@lezer/highlight';
import {currentTheme} from './themes';

const highlight=HighlightStyle.define([
 {tag:tags.keyword,color:'var(--cc-magenta)'},
 {tag:[tags.string,tags.regexp],color:'var(--cc-green)'},
 {tag:[tags.number,tags.bool,tags.null],color:'var(--cc-orange)'},
 {tag:[tags.typeName,tags.className,tags.namespace],color:'var(--cc-yellow)'},
 {tag:[tags.function(tags.variableName),tags.propertyName],color:'var(--cc-blue)'},
 {tag:[tags.operator,tags.punctuation],color:'var(--cc-text)'},
 {tag:tags.comment,color:'var(--cc-muted)',fontStyle:'italic'},
 {tag:tags.heading,color:'var(--cc-accent)',fontWeight:'bold'},
 {tag:tags.link,color:'var(--cc-blue)',textDecoration:'underline'},
 {tag:tags.invalid,color:'var(--cc-red)'},
]);
export function editorTheme(){return[
 EditorView.theme({
  '&':{color:'var(--cc-text)',backgroundColor:'var(--cc-bg)'},
  '.cm-content':{caretColor:'var(--cc-accent)'},
  '.cm-cursor,.cm-dropCursor':{borderLeftColor:'var(--cc-accent)'},
  '.cm-gutters':{color:'var(--cc-muted)',backgroundColor:'var(--cc-surface)',borderColor:'var(--cc-border)'},
  '.cm-activeLine,.cm-activeLineGutter':{backgroundColor:'var(--cc-raised)'},
  '&.cm-focused .cm-selectionBackground,.cm-selectionBackground,::selection':{backgroundColor:'var(--cc-selection)'},
  '.cm-panels,.cm-tooltip':{color:'var(--cc-text)',backgroundColor:'var(--cc-raised)',borderColor:'var(--cc-border)'},
  '.cm-searchMatch':{backgroundColor:'var(--cc-yellow-soft)'},
  '.cm-searchMatch.cm-searchMatch-selected':{outline:'1px solid var(--cc-yellow)'},
 },{dark:currentTheme().colors.mode!=='light'}),syntaxHighlighting(highlight)
];}
