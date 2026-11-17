/**
 * main.js — Ponto de entrada da aplicação Arcade Collection (Alpha)
 *
 * Inicializa:
 *  1. Banco IndexedDB (core/database)
 *   2. Carteira compartilhada (core/wallet)
 *  3. Router de navegação (src/app/router)
 *  4. Exibição da carteira no cabeçalho
 *  5. Backup/export/import (Perfil)
 *  6. Registro do Service Worker (PWA)
 *  7. Banner de instalação PWA
 */

import { openDatabase, requestPersistentStorage, verifyIntegrity } from '../core/database.js';
import {
  getEstado, getSaldo, getHistorico, addCoins, debitCoins
} from '../core/wallet.js';
import { init as initRouter, navegarPara } from './router.js';
import { downloadBackup, lerArquivoBackup, importarProgresso, validarEstrutura } from '../core/backup.js';
import { init as plinkoInit, destroy as plinkoDestroy } from '../games/plinko/index.js';

// Elementos DOM
const walletAmountEl = document.getElementById('wallet-amount');
const statSaldoEl = document.getElementById('stat-saldo');
const statPartidasEl = document.getElementById('stat-partidas');
const statConquistasEl = document.getElementById('stat-conquistas');
const btnExport = document.getElementById('btn-export');
const btnImport = document.getElementById('btn-import');
const profileBackupEl = document.getElementById('profile-backup');
const installBanner = document.getElementById('install-banner');
const installBtn = document.getElementById('install-btn');
const installDismiss = document.getElementById('install-dismiss');

let deferredPrompt = null;

/**
 * Formata número para exibição.
 */
function formatarMoeda(valor) {
  return String(Math.max(0, Math.floor(valor)));
}

/**
 * Atualiza a carteira visível no header e nos cards de status.
 */
async function atualizarCarteiraUI() {
  try {
    const estado = await getEstado();
    const saldoTexto = formatarMoeda(estado.saldo);

    if (walletAmountEl) walletAmountEl.textContent = saldoTexto;
    if (statSaldoEl) statSaldoEl.textContent = saldoTexto;

    // Atualiza partidas e conquistas a partir de stores quando disponíveis
    if (statPartidasEl) {
      const partidas = await contarPartidas();
      statPartidasEl.textContent = formatarMoeda(partidas);
    }
    if (statConquistasEl) {
      const conquistas = await contarConquistas();
      statConquistasEl.textContent = formatarMoeda(conquistas);
    }
  } catch (err) {
    console.error('[main] Falha ao atualizar carteira UI:', err);
  }
}

/**
 * Conta partidas registradas (placeholder até a implementação dos jogos).
 */
async function contarPartidas() {
  try {
    const { count } = await import('../core/database.js');
    return await count('matches');
  } catch (e) {
    return 0;
  }
}

/**
 * Conta conquistas desbloqueadas (placeholder).
 */
async function contarConquistas() {
  try {
    const { getAll } = await import('../core/database.js');
    const todas = await getAll('achievements');
    return todas.filter((a) => a.desbloqueada).length;
  } catch (e) {
    return 0;
  }
}

/**
 * Mostra um toast temporário.
 */
function mostrarToast(mensagem, duracao = 3000) {
  const template = document.getElementById('toast-template');
  const clone = template.content.cloneNode(true);
  const toast = clone.firstElementChild;
  toast.textContent = mensagem;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, duracao);
}

/**
 * Inicializa o backup (exportar / importar) na tela de Perfil.
 */
function initBackupUI() {
  if (!btnExport || !btnImport || !profileBackupEl) return;

  btnExport.addEventListener('click', async () => {
    try {
      const nome = await downloadBackup();
      mostrarToast(`Backup exportado: ${nome}`);
    } catch (err) {
      console.error('[backup] Exportação falhou:', err);
      mostrarToast('Falha ao exportar backup');
    }
  });

  // Cria input de arquivo dinamicamente
  const inputArquivo = document.createElement('input');
  inputArquivo.type = 'file';
  inputArquivo.accept = '.json';
  inputArquivo.hidden = true;
  document.body.appendChild(inputArquivo);

  btnImport.addEventListener('click', () => {
    inputArquivo.value = '';
    inputArquivo.click();
  });

  inputArquivo.addEventListener('change', async (event) => {
    const arquivo = event.target.files[0];
    if (!arquivo) return;

    // Confirmação explícita antes de restaurar
    const confirmado = confirm(
      'Tem certeza que deseja restaurar o backup?\n' +
      'Isso substituirá seu progresso atual.\n' +
      'Esta ação não pode ser desfeita.'
    );
    if (!confirmado) {
      mostrarToast('Restauração cancelada');
      return;
    }

    try {
      const dados = await lerArquivoBackup(arquivo);

      // Valida estrutura antes de importar
      const { validarEstrutura } = await import('../core/backup.js');
      const validacao = validarEstrutura(dados);
      if (!validacao.valido) {
        mostrarToast('Backup inválido: ' + validacao.erros.join(', '));
        return;
      }

      const { importarProgresso } = await import('../core/backup.js');
      const resultado = await importarProgresso(dados);

      if (resultado.ok) {
        mostrarToast('Backup restaurado com sucesso');
        await atualizarCarteiraUI();
      } else {
        mostrarToast('Falha ao restaurar: ' + (resultado.erros || ['erro desconhecido']).join(', '));
      }
    } catch (err) {
      console.error('[backup] Importação falhou:', err);
      mostrarToast('Falha ao importar backup');
    }
  });
}

/**
 * PWA: registro do Service Worker e banner de instalação.
 */
function initPWA() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker
      .register('./service-worker.js', { scope: './' })
      .then((registro) => {
        console.log('[PWA] Service Worker registrado:', registro.scope);
      })
      .catch((err) => {
        console.warn('[PWA] Falha ao registrar SW:', err);
      });
  }

  // Captura o evento beforeinstallprompt para mostrar o banner customizado
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    if (installBanner) installBanner.classList.remove('hidden');
  });

  if (installBtn) {
    installBtn.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      console.log('[PWA] Resultado da instalação:', outcome);
      deferredPrompt = null;
      if (installBanner) installBanner.classList.add('hidden');
    });
  }

  if (installDismiss) {
    installDismiss.addEventListener('click', () => {
      if (installBanner) installBanner.classList.add('hidden');
    });
  }

  // Oculta banner se já instalado (standalone)
  if (window.matchMedia('(display-mode: standalone)').matches) {
    if (installBanner) installBanner.classList.add('hidden');
  }
}

/**
 * Inicialização da aplicação.
 */
async function init() {
  try {
    // 1. Abre o banco IndexedDB
    await openDatabase();

    // 2. Solicita persistência (quando disponível)
    const persistido = await requestPersistentStorage();
    console.log('[DB] Armazenamento persistente:', persistido ? 'solicitado' : 'não disponível');

    // 3. Verifica integridade
    const integridade = await verifyIntegrity();
    console.log('[DB] Integridade:', integridade.ok ? 'ok' : 'falha', integridade);

    // 4. Inicializa router
    initRouter((area) => {
      // Atualiza a carteira sempre que entrar no início/perfil
      if (area === 'home' || area === 'profile') {
        atualizarCarteiraUI();
      }

      // Inicializa/destroi jogos conforme a área
      if (area === 'plinko') {
        plinkoInit();
      } else {
        plinkoDestroy();
      }
    });

    // 5. Atualiza carteira inicial
    await atualizarCarteiraUI();

    // 6. UI de backup
    initBackupUI();

    // 7. PWA
    initPWA();

    console.log('[APP] Arcade Collection Alpha inicializado');
  } catch (err) {
    console.error('[APP] Falha na inicialização:', err);
    mostrarToast('Erro ao inicializar o aplicativo');
  }
}

// Inicia quando o DOM estiver pronto
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
