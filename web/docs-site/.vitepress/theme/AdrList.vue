<script setup lang="ts">
import { useData, withBase } from 'vitepress'

// The sidebar for /adr/ lists every ADR; this shows the same list as the page body.
const { theme } = useData()
const adrs = (theme.value.sidebar['/adr/'][0].items as { text: string; link: string }[]).filter((i) => i.link !== '/adr/')
</script>

<template>
  <ul>
    <li v-for="a in adrs" :key="a.link">
      <a :href="withBase(a.link)">{{ a.text }}</a>
    </li>
  </ul>
</template>
