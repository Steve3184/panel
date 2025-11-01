<template>
  <div class="d-flex align-items-center py-4 bg-body-tertiary vh-100">
    <main class="form-signin w-100 m-auto">
      <form @submit.prevent="handleSetup">
        <h1 class="h3 mb-3 fw-normal">First-time Setup</h1>
        <p class="mb-3">Welcome! Please create an administrator account to begin.</p>
        <div class="form-floating">
          <input type="text" class="form-control" id="username" placeholder="admin" v-model="form.username" required>
          <label for="username">Username</label>
        </div>
        <div class="form-floating mt-2">
          <input type="password" class="form-control" id="password" placeholder="Password" v-model="form.password" required>
          <label for="password">Password</label>
        </div>
        <button class="btn btn-primary w-100 py-2 mt-3" type="submit">Create Administrator</button>
        <div v-if="error" class="alert alert-danger mt-3">{{ error }}</div>
      </form>
    </main>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import api from '../services/api';

const router = useRouter();
const form = reactive({
  username: 'admin',
  password: ''
});
const error = ref(null);

async function handleSetup() {
  error.value = null;
  if (!form.password) {
      error.value = "Password cannot be empty.";
      return;
  }
  try {
    await api.setup(form);
    alert('Admin account created successfully! Please log in.');
    router.push('/login');
  } catch (err) {
    error.value = err.message || 'An unknown error occurred during setup.';
  }
}
</script>