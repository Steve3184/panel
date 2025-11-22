<template>
  <div class="d-flex align-items-center py-4 bg-body-tertiary vh-100">
    <main class="form-signin w-100 m-auto">
      <form @submit.prevent="handleSetup">
        <h1 class="h3 mb-3 fw-normal">{{ $t('setup.heading') }}</h1>
        <p class="mb-3">{{ $t('setup.welcome') }}</p>
        <div class="form-floating">
          <input type="text" class="form-control" id="username" :placeholder="$t('setup.username.placeholder')" v-model="form.username" required>
          <label for="username">{{ $t('setup.username') }}</label>
        </div>
        <div class="form-floating mt-2">
          <input type="password" class="form-control" id="password" :placeholder="$t('setup.password.placeholder')" v-model="form.password" required>
          <label for="password">{{ $t('setup.password') }}</label>
        </div>
        <button class="btn btn-primary w-100 py-2 mt-3" type="submit">{{ $t('setup.create') }}</button>
        <div v-if="error" class="alert alert-danger mt-3">{{ error }}</div>
      </form>
    </main>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import api from '../services/api';
import { useI18n } from '../composables/useI18n';

const router = useRouter();
const form = reactive({
  username: 'admin',
  password: ''
});
const error = ref(null);
const { t } = useI18n();

async function handleSetup() {
  error.value = null;
  if (!form.password) {
      error.value = t('error.password_empty');
      return;
  }
  try {
    await api.setup(form);
    alert(t('success.admin_account_created'));
    router.push('/login');
  } catch (err) {
    error.value = err.message || t('error.unknown_setup_error');
  }
}
</script>