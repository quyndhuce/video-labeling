import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./pages/login/login.component').then(m => m.LoginComponent)
  },
  {
    path: 'register',
    loadComponent: () => import('./pages/register/register.component').then(m => m.RegisterComponent)
  },
  {
    path: '',
    canActivate: [authGuard],
    children: [
      {
        path: 'dashboard',
        loadComponent: () => import('./pages/dashboard/dashboard.component').then(m => m.DashboardComponent)
      },
      {
        path: 'qc-dashboard',
        loadComponent: () => import('./pages/qc-dashboard/qc-dashboard.component').then(m => m.QcDashboardComponent)
      },
      {
        path: 'projects/:id',
        loadComponent: () => import('./pages/project-detail/project-detail.component').then(m => m.ProjectDetailComponent)
      },
      {
        path: 'editor/:videoId',
        loadComponent: () => import('./pages/video-editor/video-editor.component').then(m => m.VideoEditorComponent)
      },
      {
        path: 'image-editor/:imageId',
        loadComponent: () => import('./pages/image-editor/image-editor.component').then(m => m.ImageEditorComponent)
      },
      {
        path: 'knowledge-base',
        loadComponent: () => import('./pages/knowledge-base/knowledge-base.component').then(m => m.KnowledgeBaseComponent)
      },
      {
        path: 'video-demo',
        loadComponent: () => import('./pages/video-demo/video-demo.component').then(m => m.VideoDemoComponent)
      },
      {
        path: '',
        redirectTo: 'dashboard',
        pathMatch: 'full'
      }
    ]
  },
  {
    path: '**',
    redirectTo: 'dashboard'
  }
];
