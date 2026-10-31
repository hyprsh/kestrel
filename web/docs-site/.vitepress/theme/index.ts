import DefaultTheme from 'vitepress/theme'
import { h } from 'vue'
import type { Theme } from 'vitepress'
import logoDark from '../../../../docs/guide/images/logo-dark.svg'
import logoLight from '../../../../docs/guide/images/logo-light.svg'
import AdrList from './AdrList.vue'
import './style.css'

export default {
  extends: DefaultTheme,
  Layout: () =>
    h(DefaultTheme.Layout, null, {
      // The logo comes from the guides' images, which are also the README's, so there is one copy.
      'nav-bar-title-before': () => [
        h('img', { class: 'kestrel-logo kestrel-logo-light', src: logoLight, alt: '', width: 24, height: 24 }),
        h('img', { class: 'kestrel-logo kestrel-logo-dark', src: logoDark, alt: '', width: 24, height: 24 }),
      ],
    }),
  enhanceApp({ app }) {
    app.component('AdrList', AdrList)
  },
} satisfies Theme
