import { createRouter, createWebHistory } from 'vue-router'
import { useSessionStore } from '../stores/session';
import Dashboard from '../views/Dashboard.vue'
import Login from '../views/Login.vue'
import Setup from '../views/Setup.vue'
import InstanceDetail from '../views/InstanceDetail.vue';
import UserManagement from '../views/UserManagement.vue';
import NotFound from '../views/NotFound.vue';
import FileManager from '../views/FileManager.vue';

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/login',
      name: 'Login',
      component: Login
    },
    {
      path: '/setup',
      name: 'Setup',
      component: Setup
    },
    {
      path: '/',
      name: 'Dashboard',
      component: Dashboard,
      meta: { requiresAuth: true }
    },
    {
      path: '/instance/:id',
      name: 'InstanceDetail',
      component: InstanceDetail,
      props: true,
      meta: { requiresAuth: true }
    },
    {
        path: '/users',
        name: 'UserManagement',
        component: UserManagement,
        meta: { requiresAuth: true, requiresAdmin: true }
    },
    {
      path: '/files',
      name: 'FileManager',
      component: FileManager,
      meta: { requiresAuth: true }
    },
    { 
      path: '/:pathMatch(.*)*', 
      name: 'NotFound', 
      component: NotFound 
    },
  ]
})

router.beforeEach(async (to, from, next) => {
  const sessionStore = useSessionStore();
  
  // 确保在检查权限之前，会话状态已经初始化
  if (sessionStore.currentUser === null && to.name !== 'Login' && to.name !== 'Setup') {
      await sessionStore.checkSession();
  }

  const requiresAuth = to.meta.requiresAuth;
  const requiresAdmin = to.meta.requiresAdmin;

  if (requiresAuth && !sessionStore.isAuthenticated) {
    next('/login');
  } else if (requiresAdmin && sessionStore.currentUser?.role !== 'admin') {
    next('/'); // Redirect non-admins trying to access admin pages
  } else {
    next();
  }
});

export default router