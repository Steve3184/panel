<template>
  <div class="card stat-card h-100">
    <div class="card-body">
      <h5 class="card-title">{{ title }}</h5>
      <p class="card-text fs-2">{{ value }}</p>
    </div>
  </div>
</template>

<script setup>
defineProps({
  title: {
    type: String,
    required: true,
  },
  value: {
    type: [String, Number],
    required: true,
  },
});
</script>

<style scoped>
.stat-card {
  text-align: center;
}
</style>