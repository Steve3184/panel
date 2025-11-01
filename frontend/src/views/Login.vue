<template>
  <body class="d-flex align-items-center py-4 bg-body-tertiary">
    <main class="form-signin w-100 m-auto">
      <form @submit.prevent="handleLogin">
        <h1 class="h3 mb-3 fw-normal">{{ $t('login.heading') }}</h1>
        <div class="form-floating">
          <input type="text" class="form-control" id="username" placeholder="Username" v-model="username" required>
          <label for="username">{{ $t('login.username') }}</label>
        </div>
        <div class="form-floating mt-2">
          <input type="password" class="form-control" id="password" placeholder="Password" v-model="password" required>
          <label for="password">{{ $t('login.password') }}</label>
        </div>
        <button class="btn btn-primary w-100 py-2 mt-3" type="submit">{{ $t('login.button') }}</button>
      </form>
    </main>
  </body>
</template>

<script setup>
import { ref } from 'vue';
import { useSessionStore } from '../stores/session';

const username = ref('');
const password = ref('');
const sessionStore = useSessionStore();

const handleLogin = () => {
  sessionStore.login({ username: username.value, password: password.value });
};
</script>