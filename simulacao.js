import { db, collection, getDocs, doc, getDoc, addDoc } from './firebase.js';

/* =====================================================================
   CONVENÇÃO DE EIXOS (3D)
   X = comprimento  (CABINE em -X  |  FUNDO/PORTAS em +X)
   Y = altura
   Z = largura      (lado ESQUERDO do veículo = +Z | lado DIREITO = -Z)
   Descarga: Baú = pelo FUNDO (+X) | Sider/Graneleiro = pelas LATERAIS (±Z)
   ===================================================================== */

// ---------- Estado ----------
let produtosDisponiveisCache = [];
let volumesPatio = [];
let volumesNoCarro = [];
let veiculoAtual = null;
let itensSimulacaoCache = [];
let volumeSelecionadoUID = null;

// Three.js
let scene, camera, renderer, controls, animId = null;
let truckContainerGroup, meshesInTruck = [];
let raycaster, mouse;
let gridHelperRef = null, wireMatRef = null, planoPisoRaycast = null;

// Posicionamento de bloco vindo do pátio
let modoPosicionamentoAtivo = false;
let blocoEmTransito = [];
let meshPreviewBloco = null;

// Movimentação no veículo
let modoMovimento = 'bloco';   // 'bloco' = volume + pilha acima | 'unico' = só o volume
let passoMov = 0.10;           // metros

// Análise de descarga
let analise = {};              // uid -> info
let resumoAnalise = null;
let mostrarBloqueios = true;

const PISO = 0.04;             // topo do piso
const TOL = 0.03;              // tolerância de "encostado"
const EPS = 0.005;             // tolerância de sobreposição

const cacheGeo = new Map();
const cacheTex = new Map();
const cacheMat = new Map();

// ---------- Utilidades ----------
const hexCss = n => '#' + n.toString(16).padStart(6, '0');
const hexRgb = n => [(n >> 16) & 255, (n >> 8) & 255, n & 255];
const nomeProd = v => `${v.codigo}${v.grade && v.grade !== 'Única' ? ' (' + v.grade + ')' : ''}`;
const rotuloVol = v => `${nomeProd(v)} - Vol ${v.volNum} (Jogo ${v.jogoNum})`;
const fmt = (n, d = 1) => Number(n).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });

let toastTimer = null;
function mostrarMsg(txt, tipo = 'info') {
  const el = document.getElementById('toast-msg');
  if (!el) { console.log(txt); return; }
  el.textContent = txt;
  el.className = `toast toast-${tipo} show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3800);
}

/* =====================================================================
   ETAPA 1 - SELEÇÃO DE PRODUTOS E VEÍCULO
   ===================================================================== */
async function carregarSelectsSimulacao() {
  const prodsSnap = await getDocs(collection(db, "produtos"));
  produtosDisponiveisCache = [];
  prodsSnap.forEach(d => produtosDisponiveisCache.push({ id: d.id, ...d.data() }));

  const selVeic = document.getElementById('sim-veiculo');
  if (selVeic) {
    selVeic.innerHTML = '';
    const veics = await getDocs(collection(db, "veiculos"));
    veics.forEach(d => {
      selVeic.innerHTML += `<option value="${d.id}">[${d.data().tipo}] ${d.data().nome} (${d.data().comprimento}m C x ${d.data().largura}m L x ${d.data().altura}m A)</option>`;
    });
  }

  const container = document.getElementById('simulacao-produtos-container');
  if (container) {
    container.innerHTML = '';
    adicionarLinhaSimulacao();
  }
}

window.adicionarLinhaSimulacao = function () {
  const container = document.getElementById('simulacao-produtos-container');
  const linhaId = 'sim-prod-row-' + Date.now() + Math.random().toString(36).substring(2, 5);

  const div = document.createElement('div');
  div.className = 'form-grid linha-sim-produto';
  div.id = linhaId;

  let optionsHtml = '<option value="">Selecione o Produto (Código - Descrição)</option>';
  produtosDisponiveisCache.forEach(p => {
    const gradeStr = p.grade ? ` | Grade: ${p.grade}` : '';
    optionsHtml += `<option value="${p.id}">${p.codigo} - ${p.descricao}${gradeStr}</option>`;
  });

  div.innerHTML = `
    <div class="field campo-produto-grande">
      <label>Produto e Grade</label>
      <select class="sim-prod-select" required>${optionsHtml}</select>
    </div>
    <div class="field">
      <label>Qtd de Jogos (Kits)</label>
      <input type="number" class="sim-prod-qtd" value="3" min="1" required>
    </div>
    <div class="field" style="display: flex; align-items: flex-end;">
      <button type="button" class="btn-remove btn-remove-linha" onclick="document.getElementById('${linhaId}').remove()">Remover</button>
    </div>
  `;
  container.appendChild(div);
};

window.iniciarMontagemProfissional = async function () {
  const linhas = document.querySelectorAll('#simulacao-produtos-container > div');
  if (linhas.length === 0) return alert("Adicione produtos à simulação!");

  const veicId = document.getElementById('sim-veiculo').value;
  if (!veicId) return alert("Selecione um veículo!");

  const veicSnap = await getDoc(doc(db, "veiculos", veicId));
  veiculoAtual = veicSnap.data();

  volumesPatio = [];
  volumesNoCarro = [];
  itensSimulacaoCache = [];
  volumeSelecionadoUID = null;
  analise = {};
  resumoAnalise = null;
  cacheTex.forEach(t => t.dispose());
  cacheTex.clear(); cacheMat.clear(); cacheGeo.clear();

  const CORES_PALETA = [0x0284c7, 0x10b981, 0xf59e0b, 0x8b5cf6, 0xec4899, 0x06b6d4, 0xef4444, 0x6366f1];
  let prodIndex = 0;

  for (let linha of linhas) {
    const prodId = linha.querySelector('.sim-prod-select').value;
    const qtdJogos = parseInt(linha.querySelector('.sim-prod-qtd').value) || 0;
    if (!prodId || qtdJogos <= 0) continue;

    const prodObj = produtosDisponiveisCache.find(p => p.id === prodId);
    if (!prodObj) continue;

    const corHex = CORES_PALETA[prodIndex % CORES_PALETA.length];
    prodIndex++;

    const volumesDoJogo = prodObj.volumes || [];
    if (volumesDoJogo.length === 0) {
      alert(`O produto ${prodObj.codigo} não possui volumes cadastrados!`);
      return;
    }

    itensSimulacaoCache.push({ produto: prodObj, qtdJogosTotal: qtdJogos, volumesDoJogo, corHex });

    for (let j = 1; j <= qtdJogos; j++) {
      volumesDoJogo.forEach(v => {
        const largura = parseFloat(v.largura) || 0.6;  // Z
        const altura = parseFloat(v.altura) || 0.4;    // Y
        const prof = parseFloat(v.prof) || 1.2;        // X
        volumesPatio.push({
          uid: 'vol-' + Math.random().toString(36).substr(2, 9),
          prodId: prodObj.id,
          codigo: prodObj.codigo,
          descricaoProd: prodObj.descricao,
          grade: prodObj.grade || 'Única',
          jogoNum: j,
          volNum: v.numero,
          volDesc: v.descricao,
          largura, altura, prof,
          peso: parseFloat(v.peso) || 15,
          corHex,
          pos: { x: 0, y: 0, z: 0 },
          rot: { x: 0, y: 0, z: 0 },
          dim: { x: prof, y: altura, z: largura }   // dimensões efetivas (mudam ao girar/deitar)
        });
      });
    }
  }

  if (volumesPatio.length === 0) return alert("Selecione produtos válidos!");

  document.getElementById('area-montagem-3d').classList.remove('hidden');

  inicializarCenarioThreeJS();
  gerarLegendaCoresAbil();
  atualizarTudo();
  document.getElementById('area-montagem-3d').scrollIntoView({ behavior: 'smooth', block: 'start' });
};

/* Atualiza todos os painéis e o 3D de uma vez */
function atualizarTudo() {
  calcularBalancoPeso3D();
  analisarDescarga();
  renderizarVolumes3DNaCena();
  atualizarPatioEDock();
  atualizarContadoresProgresso();
  renderizarPainelInspecao();
  renderizarPainelAnalise();
}

/* =====================================================================
   CENÁRIO 3D
   ===================================================================== */
function inicializarCenarioThreeJS() {
  const container = document.getElementById('canvas-3d-viewport');
  const antigo = container.querySelector('canvas');
  if (antigo) antigo.remove();
  if (animId) cancelAnimationFrame(animId);
  if (renderer) renderer.dispose();

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x090d16);

  camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 1000);
  camera.position.set(veiculoAtual.comprimento * 1.2, veiculoAtual.altura * 2.2, veiculoAtual.largura * 2.2);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.domElement.style.display = 'block';
  container.insertBefore(renderer.domElement, container.firstChild);

  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.maxPolarAngle = Math.PI;
  controls.target.set(0, veiculoAtual.altura / 3, 0);

  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();
  ligarEventosCanvas(renderer.domElement);

  scene.add(new THREE.AmbientLight(0xffffff, 0.7));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(20, 40, 20);
  scene.add(dirLight);

  gridHelperRef = new THREE.GridHelper(30, 30, 0x0284c7, 0x334155);
  gridHelperRef.position.y = -0.01;
  scene.add(gridHelperRef);

  truckContainerGroup = new THREE.Group();
  scene.add(truckContainerGroup);
  meshesInTruck = [];

  construirEstruturaCaminhao3D();

  const planeGeo = new THREE.PlaneGeometry(veiculoAtual.comprimento, veiculoAtual.largura);
  planeGeo.rotateX(-Math.PI / 2);
  planoPisoRaycast = new THREE.Mesh(planeGeo, new THREE.MeshBasicMaterial({ visible: false }));
  planoPisoRaycast.position.y = PISO;
  truckContainerGroup.add(planoPisoRaycast);

  const loop = () => {
    animId = requestAnimationFrame(loop);
    controls.update();
    renderer.render(scene, camera);
  };
  loop();

  if (!window.__resizeSimLigado) {
    window.addEventListener('resize', ajustarTamanhoRenderer);
    window.__resizeSimLigado = true;
  }
}

function ajustarTamanhoRenderer() {
  const c = document.getElementById('canvas-3d-viewport');
  if (!renderer || !camera || !c || !c.clientWidth || !c.clientHeight) return;
  camera.aspect = c.clientWidth / c.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(c.clientWidth, c.clientHeight);
}

function criarSprite(txt, corFundo = '#0f172a') {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = corFundo; g.fillRect(0, 0, 512, 128);
  g.fillStyle = '#ffffff'; g.font = 'bold 44px Arial';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(txt, 256, 64, 490);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false }));
  const s = Math.max(0.35, veiculoAtual.comprimento * 0.028);
  sp.scale.set(s * 4, s, 1);
  sp.renderOrder = 10;
  return sp;
}

function construirEstruturaCaminhao3D() {
  const comp = veiculoAtual.comprimento;
  const larg = veiculoAtual.largura;
  const alt = veiculoAtual.altura;
  const lateral = veiculoAtual.tipo !== 'Bau';

  // Piso
  const floorMesh = new THREE.Mesh(new THREE.BoxGeometry(comp, 0.08, larg), new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.8 }));
  truckContainerGroup.add(floorMesh);

  // Paredes transparentes
  wireMatRef = new THREE.MeshBasicMaterial({ color: 0x38bdf8, wireframe: true, transparent: true, opacity: 0.25 });
  const wireMesh = new THREE.Mesh(new THREE.BoxGeometry(comp, alt, larg), wireMatRef);
  wireMesh.position.set(0, alt / 2, 0);
  truckContainerGroup.add(wireMesh);

  // Cabine (frente = -X)
  const cabMesh = new THREE.Mesh(new THREE.BoxGeometry(1.2, alt * 0.9, larg), new THREE.MeshStandardMaterial({ color: 0x0284c7, transparent: true, opacity: 0.4 }));
  cabMesh.position.set(-comp / 2 - 0.6, alt * 0.45, 0);
  truckContainerGroup.add(cabMesh);

  // Indicadores de orientação e de sentido da descarga
  const verde = 0x22c55e;
  const frente = criarSprite('FRENTE (CABINE)', '#0369a1');
  frente.position.set(-comp / 2 - 0.6, alt + 0.5, 0);
  truckContainerGroup.add(frente);

  const esq = criarSprite(lateral ? 'ESQUERDA - DESCARGA' : 'ESQUERDA', lateral ? '#15803d' : '#334155');
  esq.position.set(0, alt + 0.4, larg / 2 + 0.6);
  truckContainerGroup.add(esq);
  const dir = criarSprite(lateral ? 'DIREITA - DESCARGA' : 'DIREITA', lateral ? '#15803d' : '#334155');
  dir.position.set(0, alt + 0.4, -larg / 2 - 0.6);
  truckContainerGroup.add(dir);

  if (lateral) {
    truckContainerGroup.add(new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, alt * 0.5, larg / 2 + 0.05), 1.3, verde, 0.4, 0.25));
    truckContainerGroup.add(new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, alt * 0.5, -larg / 2 - 0.05), 1.3, verde, 0.4, 0.25));
  } else {
    truckContainerGroup.add(new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(comp / 2 + 0.05, alt * 0.5, 0), 1.6, verde, 0.45, 0.3));
    const fundo = criarSprite('DESCARGA PELO FUNDO', '#15803d');
    fundo.position.set(comp / 2 + 2.4, alt * 0.5 + 0.5, 0);
    truckContainerGroup.add(fundo);
  }
}

/* =====================================================================
   GEOMETRIA / FÍSICA SIMPLES
   ===================================================================== */
function caixa(v) {
  const d = v.dim;
  return {
    minX: v.pos.x - d.x / 2, maxX: v.pos.x + d.x / 2,
    minY: v.pos.y - d.y / 2, maxY: v.pos.y + d.y / 2,
    minZ: v.pos.z - d.z / 2, maxZ: v.pos.z + d.z / 2
  };
}
const sobrepoe = (a1, a2, b1, b2) => Math.min(a2, b2) - Math.max(a1, b1) > EPS;

function envelope(conj) {
  const r = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
  conj.forEach(v => {
    const c = caixa(v);
    r.minX = Math.min(r.minX, c.minX); r.maxX = Math.max(r.maxX, c.maxX);
    r.minY = Math.min(r.minY, c.minY); r.maxY = Math.max(r.maxY, c.maxY);
    r.minZ = Math.min(r.minZ, c.minZ); r.maxZ = Math.max(r.maxZ, c.maxZ);
  });
  return r;
}

function temColisao(conj, set) {
  for (const m of conj) {
    const a = caixa(m);
    for (const w of volumesNoCarro) {
      if (set.has(w.uid)) continue;
      const b = caixa(w);
      if (sobrepoe(a.minX, a.maxX, b.minX, b.maxX) && sobrepoe(a.minY, a.maxY, b.minY, b.maxY) && sobrepoe(a.minZ, a.maxZ, b.minZ, b.maxZ)) return true;
    }
  }
  return false;
}

/* Pilha inteira apoiada em cima do volume base (incluindo ele mesmo) */
function obterBloco(base) {
  const res = [base];
  const vis = new Set([base.uid]);
  for (let i = 0; i < res.length; i++) {
    const a = caixa(res[i]);
    volumesNoCarro.forEach(w => {
      if (vis.has(w.uid)) return;
      const b = caixa(w);
      if (sobrepoe(a.minX, a.maxX, b.minX, b.maxX) && sobrepoe(a.minZ, a.maxZ, b.minZ, b.maxZ) &&
        b.minY >= a.maxY - TOL && b.minY <= a.maxY + TOL) {
        vis.add(w.uid); res.push(w);
      }
    });
  }
  return res;
}

/* Maior topo de volumes que estão ABAIXO da altura dada (para preview e queda) */
function alturaSuporte(cx, cz, dx, dz) {
  let m = PISO;
  volumesNoCarro.forEach(o => {
    const d = o.dim;
    if (Math.abs(o.pos.x - cx) < (d.x / 2 + dx / 2 - EPS) && Math.abs(o.pos.z - cz) < (d.z / 2 + dz / 2 - EPS)) {
      m = Math.max(m, o.pos.y + d.y / 2);
    }
  });
  return m;
}

/* Gravidade: o conjunto desce até apoiar no piso ou em volumes que estão embaixo dele */
function deixarCair(conj, set) {
  let queda = Infinity;
  conj.forEach(m => {
    const a = caixa(m);
    let base = PISO;
    volumesNoCarro.forEach(w => {
      if (set.has(w.uid)) return;
      const b = caixa(w);
      if (sobrepoe(a.minX, a.maxX, b.minX, b.maxX) && sobrepoe(a.minZ, a.maxZ, b.minZ, b.maxZ) && b.maxY <= a.minY + TOL) {
        base = Math.max(base, b.maxY);
      }
    });
    queda = Math.min(queda, a.minY - base);
  });
  if (isFinite(queda) && queda > 1e-6) conj.forEach(v => { v.pos.y -= queda; });
}

function assentar(lista) {
  [...lista].sort((a, b) => a.pos.y - b.pos.y).forEach(w => deixarCair([w], new Set([w.uid])));
}

/* Desliza o conjunto em um eixo até o fim do deslocamento ou até encostar (parede/outro volume) */
function deslizar(conj, set, eixo, delta) {
  let restante = Math.abs(delta);
  const sinal = Math.sign(delta);
  let movido = 0;
  for (const passo of [0.05, 0.005]) {
    while (restante > 1e-9) {
      const s = Math.min(passo, restante);
      conj.forEach(v => { v.pos[eixo] += sinal * s; });
      if (temColisao(conj, set)) {
        conj.forEach(v => { v.pos[eixo] -= sinal * s; });
        break;
      }
      restante -= s; movido += s;
    }
    if (restante <= 1e-9) break;
  }
  return sinal * movido;
}

function moverConjunto(conj, eixo, delta, cair) {
  const set = new Set(conj.map(v => v.uid));
  const env = envelope(conj);
  const meioC = veiculoAtual.comprimento / 2, meioL = veiculoAtual.largura / 2, altMax = veiculoAtual.altura;
  const lim = {
    x: [-meioC - env.minX, meioC - env.maxX],
    z: [-meioL - env.minZ, meioL - env.maxZ],
    y: [PISO - env.minY, altMax - env.maxY]
  }[eixo];
  delta = Math.max(Math.min(lim[0], 0), Math.min(Math.max(lim[1], 0), delta));
  if (Math.abs(delta) < 1e-6) return 0;
  const movido = deslizar(conj, set, eixo, delta);
  if (Math.abs(movido) < 1e-6) return 0;
  if (cair && eixo !== 'y') deixarCair(conj, set);
  return movido;
}

function selecionado() {
  return volumeSelecionadoUID ? volumesNoCarro.find(v => v.uid === volumeSelecionadoUID) : null;
}
function conjuntoDeMovimento(vol) {
  return modoMovimento === 'bloco' ? obterBloco(vol) : [vol];
}

window.ajustarPosicaoVolume = function (eixo, sinal) {
  const vol = selecionado();
  if (!vol) return;
  const acima = modoMovimento === 'unico' ? obterBloco(vol).slice(1) : [];
  const mov = moverConjunto(conjuntoDeMovimento(vol), eixo, sinal * passoMov, eixo !== 'y');
  if (modoMovimento === 'unico' && eixo !== 'y') assentar(acima);
  if (!mov) mostrarMsg('Movimento bloqueado: parede da caçamba, teto ou outro volume no caminho.', 'warn');
  atualizarTudo();
};

window.encostarSelecionado = function (eixo, sinal) {
  const vol = selecionado();
  if (!vol) return;
  const acima = modoMovimento === 'unico' ? obterBloco(vol).slice(1) : [];
  const mov = moverConjunto(conjuntoDeMovimento(vol), eixo, sinal * 100, true);
  if (modoMovimento === 'unico') assentar(acima);
  if (!mov) mostrarMsg('Já está encostado nessa direção.', 'info');
  atualizarTudo();
};

window.rotacionarVolumeSelecionado = function (eixo, angulo) {
  const vol = selecionado();
  if (!vol) return;
  if (obterBloco(vol).length > 1) return mostrarMsg('Há volumes em cima deste. Mova a pilha antes de girar ou deitar.', 'warn');

  const antes = { dim: { ...vol.dim }, pos: { ...vol.pos }, rot: { ...vol.rot } };
  if (eixo === 'y') [vol.dim.x, vol.dim.z] = [vol.dim.z, vol.dim.x];
  else if (eixo === 'z') [vol.dim.x, vol.dim.y] = [vol.dim.y, vol.dim.x];
  else if (eixo === 'x') [vol.dim.y, vol.dim.z] = [vol.dim.z, vol.dim.y];
  vol.rot[eixo] += angulo;

  const meioC = veiculoAtual.comprimento / 2, meioL = veiculoAtual.largura / 2;
  const base = antes.pos.y - antes.dim.y / 2;
  vol.pos.y = base + vol.dim.y / 2;
  vol.pos.x = Math.max(-meioC + vol.dim.x / 2, Math.min(meioC - vol.dim.x / 2, vol.pos.x));
  vol.pos.z = Math.max(-meioL + vol.dim.z / 2, Math.min(meioL - vol.dim.z / 2, vol.pos.z));

  const set = new Set([vol.uid]);
  if (vol.pos.y + vol.dim.y / 2 > veiculoAtual.altura + EPS || temColisao([vol], set)) {
    vol.dim = antes.dim; vol.pos = antes.pos; vol.rot = antes.rot;
    mostrarMsg('Sem espaço para girar/deitar nesta posição.', 'warn');
  } else {
    deixarCair([vol], set);
  }
  atualizarTudo();
};

function removerDoCarro(vol) {
  const i = volumesNoCarro.findIndex(v => v.uid === vol.uid);
  if (i > -1) volumesNoCarro.splice(i, 1);
  vol.pos = { x: 0, y: 0, z: 0 };
  vol.rot = { x: 0, y: 0, z: 0 };
  vol.dim = { x: vol.prof, y: vol.altura, z: vol.largura };
  volumesPatio.push(vol);
}

window.retornarVolumeAoPatio = function (uid) {
  const vol = volumesNoCarro.find(v => v.uid === uid);
  if (!vol) return;
  const acima = obterBloco(vol).slice(1);
  removerDoCarro(vol);
  assentar(acima);
  if (volumeSelecionadoUID === uid) volumeSelecionadoUID = null;
  atualizarTudo();
};

window.retornarBlocoAoPatio = function (uid) {
  const vol = volumesNoCarro.find(v => v.uid === uid);
  if (!vol) return;
  obterBloco(vol).forEach(removerDoCarro);
  volumeSelecionadoUID = null;
  atualizarTudo();
};

window.definirModoMovimento = function (m) {
  modoMovimento = m;
  renderizarVolumes3DNaCena();
  renderizarPainelInspecao();
};
window.definirPassoMovimento = function (v) { passoMov = parseFloat(v) || 0.1; };
window.alternarMostrarBloqueios = function () {
  mostrarBloqueios = !mostrarBloqueios;
  renderizarVolumes3DNaCena();
  renderizarPainelAnalise();
};

// Teclado (desktop): setas movem, PgUp/PgDn sobem/descem
document.addEventListener('keydown', e => {
  if (!volumeSelecionadoUID || modoPosicionamentoAtivo) return;
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
  const mapa = { ArrowUp: ['x', -1], ArrowDown: ['x', 1], ArrowLeft: ['z', 1], ArrowRight: ['z', -1], PageUp: ['y', 1], PageDown: ['y', -1] };
  const m = mapa[e.key];
  if (!m) return;
  e.preventDefault();
  window.ajustarPosicaoVolume(m[0], m[1]);
});

/* =====================================================================
   INTERAÇÃO NO CANVAS (mouse + toque)
   ===================================================================== */
const ptr = { down: null, ids: new Set(), multi: false };

function ligarEventosCanvas(el) {
  el.style.touchAction = 'none';
  el.addEventListener('pointerdown', e => {
    ptr.ids.add(e.pointerId);
    if (ptr.ids.size > 1) ptr.multi = true;
    ptr.down = { x: e.clientX, y: e.clientY, t: performance.now() };
  });
  el.addEventListener('pointermove', e => {
    if (e.pointerType === 'mouse' && modoPosicionamentoAtivo && meshPreviewBloco) posicionarPreviewNoPonto(e);
  });
  el.addEventListener('pointerup', e => {
    ptr.ids.delete(e.pointerId);
    const d = ptr.down, multi = ptr.multi;
    if (ptr.ids.size === 0) ptr.multi = false;
    ptr.down = null;
    if (!d || multi || e.button !== 0) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 8 && performance.now() - d.t < 700) onCanvasTap(e);
  });
  el.addEventListener('pointercancel', e => {
    ptr.ids.delete(e.pointerId);
    if (ptr.ids.size === 0) ptr.multi = false;
    ptr.down = null;
  });
}

function coordsDoEvento(e) {
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
}

function posicionarPreviewNoPonto(e) {
  coordsDoEvento(e);
  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObjects([planoPisoRaycast, ...meshesInTruck]);
  if (hits.length > 0) ajustarPreview(hits[0].point.x, hits[0].point.z);
}

function ajustarPreview(px, pz) {
  const u = meshPreviewBloco.userData;
  const meioC = veiculoAtual.comprimento / 2, meioL = veiculoAtual.largura / 2;
  px = Math.max(-meioC + u.tamX / 2, Math.min(meioC - u.tamX / 2, px));
  pz = Math.max(-meioL + u.tamZ / 2, Math.min(meioL - u.tamZ / 2, pz));
  const base = alturaSuporte(px, pz, u.tamX, u.tamZ);
  meshPreviewBloco.position.set(px, base + u.tamY / 2, pz);
  const estoura = base + u.tamY > veiculoAtual.altura + EPS;
  meshPreviewBloco.material.color.setHex(estoura ? 0xef4444 : 0x10b981);
}

function onCanvasTap(e) {
  if (modoPosicionamentoAtivo && meshPreviewBloco) {
    posicionarPreviewNoPonto(e);
    if (e.pointerType === 'mouse') window.confirmarPosicionamento();   // no toque: confirma pelo botão
    return;
  }
  coordsDoEvento(e);
  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObjects(meshesInTruck);
  volumeSelecionadoUID = hits.length > 0 ? hits[0].object.userData.uid : null;
  renderizarVolumes3DNaCena();
  renderizarPainelInspecao();
}

/* ---------- Posicionar volumes vindos do pátio ---------- */
window.prepararMovimentoBloco = function (prodId, volNum, qtdDesejada) {
  const candidatos = volumesPatio.filter(v => v.prodId === prodId && v.volNum === volNum);
  if (candidatos.length === 0) return;

  if (meshPreviewBloco) scene.remove(meshPreviewBloco);

  const qtdReal = Math.min(qtdDesejada, candidatos.length);
  blocoEmTransito = candidatos.slice(0, qtdReal);

  const ref = blocoEmTransito[0];
  const tamX = ref.prof, tamZ = ref.largura, tamY = ref.altura * qtdReal;

  meshPreviewBloco = new THREE.Mesh(
    new THREE.BoxGeometry(tamX, tamY, tamZ),
    new THREE.MeshStandardMaterial({ color: 0x10b981, transparent: true, opacity: 0.5 })
  );
  meshPreviewBloco.userData = { tamX, tamY, tamZ, qtdReal, girado: false };
  meshPreviewBloco.position.set(0, PISO + tamY / 2, 0);
  scene.add(meshPreviewBloco);

  volumeSelecionadoUID = null;
  modoPosicionamentoAtivo = true;
  renderizarVolumes3DNaCena();
  renderizarPainelInspecao();

  const barra = document.getElementById('barra-posicionamento');
  if (barra) {
    barra.classList.remove('hidden');
    document.getElementById('barra-pos-texto').textContent = `Posicionando ${qtdReal} vol. empilhado(s): toque/clique no local desejado`;
  }
  ajustarPreview(0, 0);
  document.getElementById('canvas-3d-viewport').scrollIntoView({ behavior: 'smooth', block: 'center' });
};

window.executarMovimentoInput = function (prodId, volNum) {
  const input = document.getElementById(`qtd-mover-${prodId}-${volNum}`);
  const qtd = parseInt(input.value) || 1;
  window.prepararMovimentoBloco(prodId, volNum, qtd);
};

window.girarBlocoPreview = function () {
  if (!meshPreviewBloco) return;
  const u = meshPreviewBloco.userData;
  [u.tamX, u.tamZ] = [u.tamZ, u.tamX];
  u.girado = !u.girado;
  meshPreviewBloco.geometry.dispose();
  meshPreviewBloco.geometry = new THREE.BoxGeometry(u.tamX, u.tamY, u.tamZ);
  ajustarPreview(meshPreviewBloco.position.x, meshPreviewBloco.position.z);
};

window.cancelarPosicionamento = function () {
  if (meshPreviewBloco) scene.remove(meshPreviewBloco);
  meshPreviewBloco = null;
  blocoEmTransito = [];
  modoPosicionamentoAtivo = false;
  const barra = document.getElementById('barra-posicionamento');
  if (barra) barra.classList.add('hidden');
};

window.confirmarPosicionamento = function () {
  if (!meshPreviewBloco || blocoEmTransito.length === 0) return;
  const u = meshPreviewBloco.userData;
  const posX = meshPreviewBloco.position.x, posZ = meshPreviewBloco.position.z;
  const baseY = meshPreviewBloco.position.y - u.tamY / 2;

  if (baseY + u.tamY > veiculoAtual.altura + EPS) {
    return mostrarMsg('A pilha ultrapassa a altura do veículo. Reduza a quantidade ou escolha outro local.', 'warn');
  }

  blocoEmTransito.forEach((vol, idx) => {
    const pIdx = volumesPatio.findIndex(v => v.uid === vol.uid);
    if (pIdx !== -1) volumesPatio.splice(pIdx, 1);

    if (u.girado) {
      vol.dim = { x: vol.largura, y: vol.altura, z: vol.prof };
      vol.rot.y += Math.PI / 2;
    } else {
      vol.dim = { x: vol.prof, y: vol.altura, z: vol.largura };
    }
    vol.pos.x = posX;
    vol.pos.z = posZ;
    vol.pos.y = baseY + idx * vol.dim.y + vol.dim.y / 2;
    volumesNoCarro.push(vol);
  });

  window.cancelarPosicionamento();
  atualizarTudo();
};

/* =====================================================================
   RENDERIZAÇÃO DOS VOLUMES
   ===================================================================== */
function texturaEtiqueta(vol) {
  const d = vol.dim;
  const key = `${vol.uid}_${d.x.toFixed(2)}_${d.y.toFixed(2)}`;
  let t = cacheTex.get(key);
  if (t) return { t, key };

  const W = 512, H = Math.max(96, Math.min(256, Math.round(W * d.y / d.x)));
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = hexCss(vol.corHex); g.fillRect(0, 0, W, H);
  g.fillStyle = '#ffffff'; g.fillRect(8, 8, W - 16, H - 16);
  g.fillStyle = '#0f172a'; g.textBaseline = 'middle';
  const fs = Math.max(14, Math.round(H / 5));
  g.font = `bold ${fs}px Arial`;
  g.fillText(`${vol.codigo}  |  ${vol.grade}`, 20, H * 0.27, W - 40);
  g.font = `${Math.round(fs * 0.85)}px Arial`;
  g.fillText(`VOL ${vol.volNum} - ${vol.volDesc}`, 20, H * 0.52, W - 40);
  g.fillText(`Jogo ${vol.jogoNum}  |  ${vol.peso} kg`, 20, H * 0.77, W - 40);

  t = new THREE.CanvasTexture(c);
  cacheTex.set(key, t);
  return { t, key };
}

function renderizarVolumes3DNaCena() {
  if (!truckContainerGroup) return;
  meshesInTruck.forEach(mesh => {
    mesh.children.slice().forEach(ch => { ch.geometry.dispose(); ch.material.dispose(); mesh.remove(ch); });
    truckContainerGroup.remove(mesh);
  });
  meshesInTruck = [];

  const sel = selecionado();
  const bloco = new Set();
  if (sel && modoMovimento === 'bloco') obterBloco(sel).forEach(v => bloco.add(v.uid));

  volumesNoCarro.forEach(vol => {
    const d = vol.dim;
    const gk = `${d.x.toFixed(3)}_${d.y.toFixed(3)}_${d.z.toFixed(3)}`;
    let geo = cacheGeo.get(gk);
    if (!geo) { geo = new THREE.BoxGeometry(d.x, d.y, d.z); cacheGeo.set(gk, geo); }

    const conflito = mostrarBloqueios && analise[vol.uid] && analise[vol.uid].outros > 0;
    const mk = `c_${vol.corHex}_${conflito ? 1 : 0}`;
    let matCor = cacheMat.get(mk);
    if (!matCor) {
      matCor = new THREE.MeshStandardMaterial({ color: vol.corHex, roughness: 0.4 });
      if (conflito) { matCor.emissive = new THREE.Color(0xff0000); matCor.emissiveIntensity = 0.45; }
      cacheMat.set(mk, matCor);
    }
    const { t, key } = texturaEtiqueta(vol);
    let matEt = cacheMat.get('e_' + key);
    if (!matEt) { matEt = new THREE.MeshStandardMaterial({ map: t }); cacheMat.set('e_' + key, matEt); }

    const mesh = new THREE.Mesh(geo, [matCor, matCor, matCor, matCor, matEt, matEt]);
    mesh.position.set(vol.pos.x, vol.pos.y, vol.pos.z);

    if (vol.uid === volumeSelecionadoUID) {
      mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0xffffff })));
    } else if (bloco.has(vol.uid)) {
      mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0xfbbf24 })));
    }

    mesh.userData = { uid: vol.uid };
    truckContainerGroup.add(mesh);
    meshesInTruck.push(mesh);
  });
}

/* =====================================================================
   PÁTIO, PAINÉIS E CONTADORES
   ===================================================================== */
function atualizarPatioEDock() {
  const dock = document.getElementById('dock-patio-volumes');
  if (!dock) return;
  dock.innerHTML = '';

  if (volumesPatio.length === 0) {
    dock.innerHTML = `<p class="txt-suave" style="text-align:center; padding:15px;">Todos os volumes foram carregados!</p>`;
    return;
  }

  const grupos = {};
  volumesPatio.forEach(v => {
    const chave = `${v.prodId}_${v.volNum}`;
    if (!grupos[chave]) grupos[chave] = [];
    grupos[chave].push(v);
  });

  Object.keys(grupos).forEach(chave => {
    const lista = grupos[chave];
    const primeiro = lista[0];

    const card = document.createElement('div');
    card.className = 'vol-card-dock';
    card.style.borderLeft = `6px solid ${hexCss(primeiro.corHex)}`;
    card.innerHTML = `
      <strong style="color:#0f172a;">${primeiro.codigo} - ${primeiro.descricaoProd}</strong><br>
      <span style="font-size:0.75rem; color:#0284c7; font-weight:bold;">Grade: ${primeiro.grade} | Vol ${primeiro.volNum}: ${primeiro.volDesc}</span><br>
      <small>Disponível no Pátio: <strong>${lista.length} un.</strong></small><br>
      <div style="margin-top: 8px; display:flex; align-items:center; gap:5px;">
        <input type="number" id="qtd-mover-${primeiro.prodId}-${primeiro.volNum}" value="${lista.length}" min="1" max="${lista.length}" style="width:56px; padding:5px; font-size:0.8rem;">
        <button class="btn-primary" style="padding: 6px 8px; font-size: 0.72rem; flex:1;" onclick="executarMovimentoInput('${primeiro.prodId}', '${primeiro.volNum}')">🎯 Escolher Posição no Carro</button>
      </div>
    `;
    dock.appendChild(card);
  });
}

function renderizarPainelInspecao() {
  const container = document.getElementById('conteudo-painel-inspecao');
  if (!container) return;
  const vol = selecionado();

  if (!vol) {
    container.innerHTML = `<p class="txt-suave">Nenhuma caixa selecionada. Toque/clique em uma caixa dentro da caçamba 3D para ver o produto, o peso, e mover o volume ou a pilha inteira.</p>`;
    return;
  }

  const bloco = obterBloco(vol);
  const pesoBloco = bloco.reduce((s, v) => s + v.peso, 0);
  const an = analise[vol.uid];
  const passos = [0.05, 0.10, 0.25, 0.50, 1.00];

  container.innerHTML = `
    <div class="insp-info" style="border-left: 4px solid ${hexCss(vol.corHex)};">
      <strong style="color: #0284c7;">📦 ${vol.codigo} - ${vol.descricaoProd}</strong><br>
      <span style="font-size:0.8rem;">Grade: <strong>${vol.grade}</strong> | Jogo nº ${vol.jogoNum}</span><br>
      <small>Volume: <strong>${vol.volNum} (${vol.volDesc})</strong> | Peso: <strong>${vol.peso} kg</strong></small>
      ${an ? `<br><small>🚚 Saída: <strong>${an.saidaLabel}</strong> | Etapa <strong>${an.etapa}</strong> | Nível ${an.nivel}<br>
      ${an.total === 0 ? '<span style="color:#15803d;">Livre para retirar</span>' : `Antes de retirar: <strong>${an.total}</strong> vol.${an.outros ? ` (<span style="color:#b91c1c;"><strong>${an.outros}</strong> de outro produto/grade</span>)` : ' (mesmo produto)'}`}</small>` : ''}
    </div>

    <div class="insp-modo">
      <label><input type="radio" name="modo-mov" ${modoMovimento === 'bloco' ? 'checked' : ''} onchange="definirModoMovimento('bloco')"> <strong>Mover BLOCO</strong> (este + pilha acima: ${bloco.length} vol. | ${fmt(pesoBloco)} kg)</label>
      <label><input type="radio" name="modo-mov" ${modoMovimento === 'unico' ? 'checked' : ''} onchange="definirModoMovimento('unico')"> Mover só este volume</label>
    </div>

    <div class="insp-passo">
      <label>Passo (m):</label>
      <select onchange="definirPassoMovimento(this.value)">
        ${passos.map(p => `<option value="${p}" ${p === passoMov ? 'selected' : ''}>${p.toFixed(2)}</option>`).join('')}
      </select>
    </div>

    <h5 class="insp-titulo">📍 Mover ${modoMovimento === 'bloco' ? 'bloco' : 'volume'}:</h5>
    <div class="dpad">
      <span></span>
      <button class="btn-secondary btn-mini" onclick="ajustarPosicaoVolume('x', -1)">⬆ Frente</button>
      <span></span>
      <button class="btn-secondary btn-mini" onclick="ajustarPosicaoVolume('z', 1)">⬅ Esq.</button>
      <button class="btn-secondary btn-mini" onclick="ajustarPosicaoVolume('y', 1)">🔼 Subir</button>
      <button class="btn-secondary btn-mini" onclick="ajustarPosicaoVolume('z', -1)">Dir. ➡</button>
      <span></span>
      <button class="btn-secondary btn-mini" onclick="ajustarPosicaoVolume('x', 1)">⬇ Trás</button>
      <span></span>
    </div>
    <button class="btn-secondary btn-mini" style="width:100%; margin-top:6px;" onclick="ajustarPosicaoVolume('y', -1)">🔽 Descer</button>

    <h5 class="insp-titulo">🧲 Encostar até bater:</h5>
    <div class="grade-2">
      <button class="btn-secondary btn-mini" onclick="encostarSelecionado('x', -1)">Na frente</button>
      <button class="btn-secondary btn-mini" onclick="encostarSelecionado('x', 1)">No fundo</button>
      <button class="btn-secondary btn-mini" onclick="encostarSelecionado('z', 1)">Lado esq.</button>
      <button class="btn-secondary btn-mini" onclick="encostarSelecionado('z', -1)">Lado dir.</button>
    </div>

    <h5 class="insp-titulo">🔄 Rotação (só volume sem pilha em cima):</h5>
    <div class="grade-2">
      <button class="btn-secondary btn-mini" onclick="rotacionarVolumeSelecionado('y', Math.PI/2)">🔄 Girar 90°</button>
      <button class="btn-secondary btn-mini" onclick="rotacionarVolumeSelecionado('z', Math.PI/2)">📐 Deitar / Em pé</button>
    </div>

    <div class="grade-2" style="margin-top:10px;">
      <button class="btn-remove" style="font-size:0.75rem;" onclick="retornarVolumeAoPatio('${vol.uid}')">🗑️ Volume ao Pátio</button>
      <button class="btn-remove" style="font-size:0.75rem;" onclick="retornarBlocoAoPatio('${vol.uid}')">🗑️ Bloco ao Pátio</button>
    </div>
    <p class="txt-suave" style="margin-top:8px;">Teclado: setas movem | PgUp/PgDn sobem e descem.</p>
  `;
}

function gerarLegendaCoresAbil() {
  const container = document.getElementById('painel-legenda-cores');
  if (!container) return;
  let html = `<h4 style="font-size:0.9rem; color:#0284c7; margin-bottom:8px;">🎨 Legenda de Cores por Produto / Grade:</h4><div style="display:flex; flex-wrap:wrap; gap:10px;">`;
  itensSimulacaoCache.forEach(item => {
    html += `
      <div style="display:flex; align-items:center; gap:6px; background:#fff; padding:6px 10px; border-radius:5px; border:1px solid #cbd5e1; font-size:0.8rem;">
        <div style="width:16px; height:16px; background:${hexCss(item.corHex)}; border-radius:3px;"></div>
        <span><strong>${item.produto.codigo}</strong> (${item.produto.grade || 'Padrão'})</span>
      </div>`;
  });
  html += `</div>`;
  container.innerHTML = html;
}

function contarJogos(item) {
  const volsNoJogo = item.volumesDoJogo.length;
  let completos = 0;
  for (let j = 1; j <= item.qtdJogosTotal; j++) {
    const n = volumesNoCarro.filter(v => v.prodId === item.produto.id && v.jogoNum === j).length;
    if (n === volsNoJogo) completos++;
  }
  const volsCarro = volumesNoCarro.filter(v => v.prodId === item.produto.id).length;
  return { completos, volsCarro, volsTotal: item.qtdJogosTotal * volsNoJogo };
}

function atualizarContadoresProgresso() {
  const container = document.getElementById('lista-contadores-progresso');
  if (!container) return;
  let html = '';
  itensSimulacaoCache.forEach(item => {
    const c = contarJogos(item);
    html += `
      <div style="font-size: 0.85rem; margin-bottom: 4px;">
        • <strong>${item.produto.codigo} - ${item.produto.descricao}</strong> (Grade: ${item.produto.grade || 'Única'}):
        <strong>${c.completos} de ${item.qtdJogosTotal} Jogos Completos</strong> (${c.volsCarro} de ${c.volsTotal} vol)
      </div>`;
  });
  container.innerHTML = html || 'Nenhum volume carregado.';
}

/* =====================================================================
   PESO E EQUILÍBRIO
   ===================================================================== */
function calcularEstatisticas() {
  const comp = veiculoAtual.comprimento;
  let f = 0, m = 0, t = 0, e = 0, d = 0, tot = 0, vol = 0, maxX = -Infinity;
  volumesNoCarro.forEach(v => {
    tot += v.peso;
    vol += v.prof * v.altura * v.largura;
    if (v.pos.x < -comp / 6) f += v.peso; else if (v.pos.x > comp / 6) t += v.peso; else m += v.peso;
    if (v.pos.z > 0) e += v.peso; else d += v.peso;      // esquerda = +Z
    maxX = Math.max(maxX, v.pos.x + v.dim.x / 2);
  });
  const pc = x => tot ? Math.round((x / tot) * 100) : 0;
  const volVeiculo = comp * veiculoAtual.largura * veiculoAtual.altura;
  return {
    pesoTotal: tot, pesoFrente: f, pesoMeio: m, pesoTras: t, pesoEsq: e, pesoDir: d,
    pF: pc(f), pM: pc(m), pT: pc(t), pE: tot ? pc(e) : 50, pD: tot ? pc(d) : 50,
    volM3: vol, ocupPct: volVeiculo ? (vol / volVeiculo) * 100 : 0,
    compOcupado: tot ? maxX + comp / 2 : 0
  };
}

function calcularBalancoPeso3D() {
  const s = calcularEstatisticas();
  atualizarStat('stat-frente', `Frente: ${s.pesoFrente.toFixed(1)} kg (${s.pF}%)`, s.pF > 45);
  atualizarStat('stat-meio', `Centro: ${s.pesoMeio.toFixed(1)} kg (${s.pM}%)`, s.pM > 60);
  atualizarStat('stat-tras', `Trás: ${s.pesoTras.toFixed(1)} kg (${s.pT}%)`, s.pT > 45);
  atualizarStat('stat-lateral', `Esq: ${s.pE}% | Dir: ${s.pD}%`, Math.abs(s.pE - s.pD) > 20);
}

function atualizarStat(id, texto, alerta) {
  const el = document.getElementById(id);
  if (el) {
    el.innerText = texto;
    el.className = alerta ? 'weight-indicator weight-alert' : 'weight-indicator weight-ok';
  }
}

/* =====================================================================
   ANÁLISE DE DESCARGA
   Baú: sai pelo FUNDO (+X). Sider/Graneleiro: sai pelas LATERAIS (±Z).
   Um volume está "preso" por: tudo que está em cima dele + tudo que está
   no caminho até a saída (no mesmo nível). Conflito = prender por volumes
   de OUTRO produto/grade (que atrapalham a montagem do palete).
   ===================================================================== */
function analisarDescarga() {
  analise = {};
  resumoAnalise = null;
  const n = volumesNoCarro.length;
  if (!n) return;

  const lateral = veiculoAtual.tipo !== 'Bau';
  const B = volumesNoCarro.map(caixa);
  const saidas = lateral ? ['Lateral esquerda', 'Lateral direita'] : ['Fundo (portas)'];
  const adj = saidas.map(() => Array.from({ length: n }, () => []));
  const abaixo = Array.from({ length: n }, () => []);

  for (let i = 0; i < n; i++) {
    const a = B[i];
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const b = B[j];
      const ovX = sobrepoe(a.minX, a.maxX, b.minX, b.maxX);
      const ovY = sobrepoe(a.minY, a.maxY, b.minY, b.maxY);
      const ovZ = sobrepoe(a.minZ, a.maxZ, b.minZ, b.maxZ);
      if (ovX && ovZ && b.minY >= a.maxY - TOL) adj.forEach(ad => ad[i].push(j));            // j está acima de i
      if (ovX && ovZ && Math.abs(b.maxY - a.minY) <= TOL) abaixo[i].push(j);                  // j apoia i
      if (!lateral) {
        if (ovZ && ovY && b.minX >= a.maxX - TOL) adj[0][i].push(j);                          // j está atrás (no caminho do fundo)
      } else {
        if (ovX && ovY && b.minZ >= a.maxZ - TOL) adj[0][i].push(j);                          // j entre i e o lado esquerdo (+Z)
        if (ovX && ovY && b.maxZ <= a.minZ + TOL) adj[1][i].push(j);                          // j entre i e o lado direito (-Z)
      }
    }
  }

  // Nível (camada) de cada volume
  const nivel = new Array(n).fill(1);
  [...Array(n).keys()].sort((p, q) => B[p].minY - B[q].minY).forEach(i => {
    abaixo[i].forEach(j => { nivel[i] = Math.max(nivel[i], nivel[j] + 1); });
  });

  // Etapas de descarga (ondas)
  const etapaDe = new Array(n).fill(0);
  let restantes = new Set([...Array(n).keys()]);
  let etapa = 0;
  while (restantes.size) {
    etapa++;
    const liberados = [];
    restantes.forEach(i => { if (adj.some(ad => ad[i].every(j => !restantes.has(j)))) liberados.push(i); });
    if (!liberados.length) { restantes.forEach(i => { etapaDe[i] = etapa; }); break; }
    liberados.forEach(i => { etapaDe[i] = etapa; restantes.delete(i); });
  }

  const fecho = (ad, i) => {
    const vis = new Set(), pilha = [i];
    while (pilha.length) {
      const k = pilha.pop();
      ad[k].forEach(j => { if (!vis.has(j)) { vis.add(j); pilha.push(j); } });
    }
    vis.delete(i);
    return vis;
  };

  let comBloqueio = 0;
  for (let i = 0; i < n; i++) {
    const v = volumesNoCarro[i];
    let melhor = null;
    adj.forEach((ad, e) => {
      const f = fecho(ad, i);
      const outrosArr = [...f].filter(j => volumesNoCarro[j].prodId !== v.prodId);
      const cand = { e, total: f.size, outros: outrosArr.length, outrosArr };
      if (!melhor || cand.outros < melhor.outros || (cand.outros === melhor.outros && cand.total < melhor.total)) melhor = cand;
    });
    const porProduto = {};
    melhor.outrosArr.forEach(j => { const k = nomeProd(volumesNoCarro[j]); porProduto[k] = (porProduto[k] || 0) + 1; });
    if (melhor.outros > 0) comBloqueio++;
    analise[v.uid] = {
      saida: melhor.e, saidaLabel: saidas[melhor.e], total: melhor.total, outros: melhor.outros,
      porProduto, etapa: etapaDe[i], nivel: nivel[i], rotulo: rotuloVol(v)
    };
  }

  resumoAnalise = {
    n, comBloqueio, pctLimpa: Math.round(((n - comBloqueio) / n) * 100),
    etapas: Math.max(...etapaDe), lateral,
    tipoDescarga: lateral ? 'LATERAL (pelos lados esquerdo/direito)' : 'PELO FUNDO (portas traseiras)'
  };
}

function renderizarPainelAnalise() {
  const el = document.getElementById('painel-analise-descarga');
  if (!el) return;
  if (!resumoAnalise) {
    el.innerHTML = `<span class="txt-suave">Posicione volumes na caçamba para ver a análise de descarga.</span>`;
    return;
  }
  const r = resumoAnalise;
  const piores = Object.values(analise).filter(a => a.outros > 0).sort((a, b) => b.outros - a.outros).slice(0, 5);
  el.innerHTML = `
    <div class="badge ${r.comBloqueio === 0 ? 'badge-ok' : 'badge-alerta'}">
      ${r.comBloqueio === 0 ? '✅ Descarga limpa: nenhum volume preso por outro produto/grade' : `⚠ ${r.comBloqueio} de ${r.n} volume(s) presos por outro produto/grade`}
    </div>
    <div style="font-size:0.8rem; margin:6px 0;">Descarga <strong>${r.tipoDescarga}</strong> | ${r.pctLimpa}% dos volumes livres de bloqueio | ${r.etapas} etapa(s)</div>
    ${piores.length ? `<ul class="lista-bloqueios">${piores.map(a => `<li><strong>${a.rotulo}</strong> preso por ${Object.entries(a.porProduto).map(([k, q]) => `${k} x${q}`).join(', ')}</li>`).join('')}</ul>` : ''}
    <button class="btn-secondary btn-mini" onclick="alternarMostrarBloqueios()">${mostrarBloqueios ? '👁 Ocultar' : '👁 Mostrar'} bloqueios em vermelho no 3D</button>
  `;
}

/* =====================================================================
   RELATÓRIO PDF PROFISSIONAL (jsPDF + autoTable)
   ===================================================================== */
function capturarVistas() {
  const comp = veiculoAtual.comprimento, larg = veiculoAtual.largura, alt = veiculoAtual.altura;
  const vistas = [];

  const bgOld = scene.background, selOld = volumeSelecionadoUID, mostrarOld = mostrarBloqueios;
  const corWire = wireMatRef.color.getHex(), opWire = wireMatRef.opacity;
  scene.background = new THREE.Color(0xffffff);
  gridHelperRef.visible = false;
  wireMatRef.color.setHex(0x0f172a); wireMatRef.opacity = 0.55;
  if (meshPreviewBloco) meshPreviewBloco.visible = false;
  volumeSelecionadoUID = null;

  const tmp = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  tmp.setPixelRatio(1);
  const gerar = (cam, w, h) => {
    tmp.setSize(w, h, false);
    tmp.render(scene, cam);
    return tmp.domElement.toDataURL('image/jpeg', 0.9);
  };
  const orto = (wM, hM, pos, alvo, up) => {
    const c = new THREE.OrthographicCamera(-wM / 2, wM / 2, hM / 2, -hM / 2, 0.1, 200);
    c.up.set(up[0], up[1], up[2]);
    c.position.set(pos[0], pos[1], pos[2]);
    c.lookAt(alvo[0], alvo[1], alvo[2]);
    return c;
  };
  const cx = -0.6; // centro incluindo a cabine
  const iso = () => {
    const c = new THREE.PerspectiveCamera(35, 1280 / 720, 0.1, 300);
    c.position.set(comp * 0.55 + 4, alt * 1.5 + 2, larg * 1.9 + 4.5);
    c.lookAt(-0.3, alt * 0.35, 0);
    return c;
  };

  try {
    mostrarBloqueios = false;
    renderizarVolumes3DNaCena();

    vistas.push({ titulo: 'Vista isométrica', legenda: 'Visão geral da carga (cada cor = um produto/grade).', data: gerar(iso(), 1280, 720), w: 1280, h: 720, larguraMm: 182 });

    let wM = comp + 2.4, hM = larg + 1.0;
    let W = 1600, H = Math.round(W * hM / wM);
    vistas.push({ titulo: 'Vista superior', legenda: 'Cabine à esquerda. O lado DIREITO do veículo fica na parte de cima da imagem.', data: gerar(orto(wM, hM, [cx, 30, 0], [cx, 0, 0], [0, 0, -1]), W, H), w: W, h: H, larguraMm: 182 });

    hM = alt + 0.8; H = Math.round(W * hM / wM);
    vistas.push({ titulo: 'Vista lateral (lado esquerdo)', legenda: 'Cabine à esquerda. Mostra níveis de empilhamento.', data: gerar(orto(wM, hM, [cx, alt / 2, 30], [cx, alt / 2, 0], [0, 1, 0]), W, H), w: W, h: H, larguraMm: 182 });

    wM = larg + 1.0; W = 1000; H = Math.round(W * hM / wM);
    vistas.push({ titulo: 'Vista traseira (fundo)', legenda: 'Como o recebedor enxerga a carga ao abrir as portas traseiras.', data: gerar(orto(wM, hM, [30, alt / 2, 0], [0, alt / 2, 0], [0, 1, 0]), W, H), w: W, h: H, larguraMm: 90 });

    if (resumoAnalise && resumoAnalise.comBloqueio > 0) {
      mostrarBloqueios = true;
      renderizarVolumes3DNaCena();
      vistas.push({ titulo: 'Mapa de bloqueios', legenda: 'Volumes em VERMELHO só saem depois de retirar volumes de outro produto/grade.', data: gerar(iso(), 1280, 720), w: 1280, h: 720, larguraMm: 150 });
    }
  } finally {
    tmp.dispose();
    scene.background = bgOld;
    gridHelperRef.visible = true;
    wireMatRef.color.setHex(corWire); wireMatRef.opacity = opWire;
    if (meshPreviewBloco) meshPreviewBloco.visible = true;
    volumeSelecionadoUID = selOld;
    mostrarBloqueios = mostrarOld;
    renderizarVolumes3DNaCena();
  }
  return vistas;
}

function lerDadosRelatorio() {
  const g = id => (document.getElementById(id)?.value || '').trim();
  return { cliente: g('rel-cliente'), fornecedor: g('rel-fornecedor'), placa: g('rel-placa'), pedido: g('rel-pedido'), obs: g('rel-obs') };
}

window.gerarRelatorioPDF = async function (compartilhar = false) {
  if (!volumesNoCarro.length) return mostrarMsg('Nenhum volume na caçamba para gerar o relatório.', 'warn');
  if (!window.jspdf) return mostrarMsg('A biblioteca de PDF não carregou. Verifique a internet e recarregue a página.', 'erro');

  mostrarMsg('Gerando PDF profissional...', 'info');
  await new Promise(r => setTimeout(r, 80));

  try {
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
    const W = 210, H = 297, M = 14, CW = W - 2 * M;
    const AZUL = [2, 132, 199], ESC = [30, 41, 59], CINZA = [100, 116, 139], CLARO = [241, 245, 249];

    const agora = new Date();
    const dataStr = agora.toLocaleDateString('pt-BR') + ' ' + agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const p2 = n => String(n).padStart(2, '0');
    const numDoc = `PLC-${agora.getFullYear()}${p2(agora.getMonth() + 1)}${p2(agora.getDate())}-${p2(agora.getHours())}${p2(agora.getMinutes())}`;

    const dados = lerDadosRelatorio();
    const st = calcularEstatisticas();
    const lateral = veiculoAtual.tipo !== 'Bau';
    const fornecedoresAuto = [...new Set(itensSimulacaoCache.map(i => i.produto.fornecedor).filter(Boolean))].join(', ');
    const vistas = capturarVistas();

    const cabecalho = () => {
      pdf.setFillColor(...ESC); pdf.rect(0, 0, W, 20, 'F');
      pdf.setFillColor(...AZUL); pdf.rect(0, 20, W, 1.2, 'F');
      pdf.setTextColor(255, 255, 255); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(16);
      pdf.text('LogiPalete', M, 12.5);
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9);
      pdf.text('Plano de Carregamento e Descarga', W - M, 12.5, { align: 'right' });
    };

    let y = 30;
    const novaPagina = () => { pdf.addPage(); cabecalho(); y = 30; };
    const garantir = h => { if (y + h > H - 18) novaPagina(); };
    const secao = t => {
      garantir(18);
      pdf.setFillColor(...AZUL); pdf.rect(M, y - 4.2, 1.6, 6, 'F');
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11); pdf.setTextColor(...ESC);
      pdf.text(t, M + 4, y);
      y += 6;
    };
    const aposTabela = () => { y = pdf.lastAutoTable.finalY + 8; };
    const paragrafo = (txt, size = 8.5, cor = ESC) => {
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(size); pdf.setTextColor(...cor);
      const linhas = pdf.splitTextToSize(txt, CW);
      garantir(linhas.length * 4.3 + 2);
      pdf.text(linhas, M, y);
      y += linhas.length * 4.3 + 2;
    };
    const base = {
      theme: 'grid',
      margin: { top: 28, left: M, right: M, bottom: 18 },
      styles: { font: 'helvetica', fontSize: 8, cellPadding: 1.8, lineColor: [226, 232, 240], lineWidth: 0.1, textColor: ESC },
      headStyles: { fillColor: ESC, textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      didDrawPage: cabecalho
    };
    const kpi = (x, yy, w, h, rotulo, valor, sub, cor) => {
      pdf.setFillColor(248, 250, 252); pdf.setDrawColor(226, 232, 240);
      pdf.roundedRect(x, yy, w, h, 2, 2, 'FD');
      pdf.setFillColor(...cor); pdf.rect(x, yy + 2, 1.2, h - 4, 'F');
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7); pdf.setTextColor(...CINZA);
      pdf.text(rotulo.toUpperCase(), x + 4, yy + 6);
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(15); pdf.setTextColor(15, 23, 42);
      pdf.text(String(valor), x + 4, yy + 14.5);
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(6.8); pdf.setTextColor(...CINZA);
      pdf.text(sub, x + 4, yy + h - 2.6);
    };

    /* ---------- PÁGINA 1: RESUMO ---------- */
    cabecalho();
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(15); pdf.setTextColor(...ESC);
    pdf.text('RELATÓRIO DE PLANO DE CARREGAMENTO', M, y);
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5); pdf.setTextColor(...CINZA);
    pdf.text(`Documento Nº ${numDoc}   |   Emitido em ${dataStr}`, M, y + 5.5);
    y += 11;

    const cel = t => ({ content: t, styles: { fontStyle: 'bold', fillColor: CLARO, textColor: CINZA, cellWidth: 30 } });
    pdf.autoTable({
      ...base, startY: y, theme: 'grid', head: [],
      body: [
        [cel('Cliente / Destino'), dados.cliente || '-', cel('Fornecedor'), dados.fornecedor || fornecedoresAuto || '-'],
        [cel('Veículo'), `${veiculoAtual.nome}`, cel('Tipo de carroceria'), veiculoAtual.tipo],
        [cel('Dimensões úteis'), `${fmt(veiculoAtual.comprimento, 2)} x ${fmt(veiculoAtual.largura, 2)} x ${fmt(veiculoAtual.altura, 2)} m (C x L x A)`, cel('Placa'), dados.placa || '-'],
        [cel('Pedido / NF'), dados.pedido || '-', cel('Sentido da descarga'), lateral ? 'LATERAL' : 'PELO FUNDO']
      ],
      columnStyles: { 1: { cellWidth: 61 }, 3: { cellWidth: 61 } }
    });
    y = pdf.lastAutoTable.finalY + 6;

    const kw = (CW - 12) / 4;
    const pctLimpa = resumoAnalise ? resumoAnalise.pctLimpa : 100;
    kpi(M, y, kw, 22, 'Volumes carregados', volumesNoCarro.length, `${volumesPatio.length} ainda no pátio`, AZUL);
    kpi(M + (kw + 4), y, kw, 22, 'Peso total', `${fmt(st.pesoTotal)} kg`, `${fmt(st.volM3, 2)} m3 de carga`, [16, 185, 129]);
    kpi(M + 2 * (kw + 4), y, kw, 22, 'Ocupação (cubagem)', `${fmt(st.ocupPct, 0)}%`, `${fmt(st.compOcupado, 2)} m de ${fmt(veiculoAtual.comprimento, 2)} m`, [245, 158, 11]);
    kpi(M + 3 * (kw + 4), y, kw, 22, 'Descarga sem bloqueio', `${pctLimpa}%`, resumoAnalise && resumoAnalise.comBloqueio ? `${resumoAnalise.comBloqueio} vol. presos por outro produto` : 'nenhum volume preso por outro produto', pctLimpa === 100 ? [16, 185, 129] : [239, 68, 68]);
    y += 30;

    secao('Distribuição de peso e equilíbrio');
    const linhaPeso = (zona, kg, pc, alerta) => [zona, fmt(kg), `${pc}%`, alerta ? 'ATENÇÃO' : 'OK'];
    pdf.autoTable({
      ...base, startY: y,
      head: [['Zona da carga', 'Peso (kg)', 'Participação', 'Situação']],
      body: [
        linhaPeso('Frente (próximo à cabine)', st.pesoFrente, st.pF, st.pF > 45),
        linhaPeso('Centro', st.pesoMeio, st.pM, st.pM > 60),
        linhaPeso('Trás (portas)', st.pesoTras, st.pT, st.pT > 45),
        linhaPeso('Lado esquerdo', st.pesoEsq, st.pE, Math.abs(st.pE - st.pD) > 20),
        linhaPeso('Lado direito', st.pesoDir, st.pD, Math.abs(st.pE - st.pD) > 20)
      ],
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'center', fontStyle: 'bold' } },
      didParseCell: d => {
        if (d.section === 'body' && d.column.index === 3) d.cell.styles.textColor = d.cell.raw === 'OK' ? [21, 128, 61] : [185, 28, 28];
      }
    });
    aposTabela();

    secao('Produtos e grades');
    const gradeProd = itensSimulacaoCache.map(item => {
      const c = contarJogos(item);
      const peso = volumesNoCarro.filter(v => v.prodId === item.produto.id).reduce((s, v) => s + v.peso, 0);
      return { item, c, peso };
    });
    pdf.autoTable({
      ...base, startY: y,
      head: [['Código', 'Descrição', 'Grade', 'Fornecedor', 'Jogos (carregados/total)', 'Volumes', 'Peso (kg)']],
      body: gradeProd.map(g => [g.item.produto.codigo, g.item.produto.descricao, g.item.produto.grade || 'Única', g.item.produto.fornecedor || '-', `${g.c.completos} / ${g.item.qtdJogosTotal}`, `${g.c.volsCarro} / ${g.c.volsTotal}`, fmt(g.peso)]),
      columnStyles: { 0: { cellPadding: { top: 1.8, bottom: 1.8, left: 7, right: 1.8 } }, 4: { halign: 'center' }, 5: { halign: 'center' }, 6: { halign: 'right' } },
      didDrawCell: d => {
        if (d.section === 'body' && d.column.index === 0) {
          pdf.setFillColor(...hexRgb(gradeProd[d.row.index].item.corHex));
          pdf.roundedRect(d.cell.x + 1.8, d.cell.y + (d.cell.height - 3.4) / 2, 3.4, 3.4, 0.6, 0.6, 'F');
        }
      }
    });
    aposTabela();

    /* ---------- ANÁLISE DE DESCARGA ---------- */
    secao('Análise de descarga');
    if (resumoAnalise) {
      paragrafo(`Veículo ${veiculoAtual.tipo}: descarga ${resumoAnalise.tipoDescarga}. O plano possui ${resumoAnalise.etapas} etapa(s) de retirada; ${resumoAnalise.pctLimpa}% dos volumes podem ser retirados sem mexer em volumes de outro produto/grade.`);
      const piores = Object.values(analise).filter(a => a.outros > 0).sort((a, b) => b.outros - a.outros).slice(0, 12);
      if (piores.length) {
        pdf.autoTable({
          ...base, startY: y,
          head: [['Volume preso', 'Saída', 'Precisa retirar antes (outro produto/grade)', 'Qtd.']],
          body: piores.map(a => [a.rotulo, a.saidaLabel, Object.entries(a.porProduto).map(([k, q]) => `${k} x${q}`).join(', '), a.outros]),
          columnStyles: { 3: { halign: 'center' } },
          headStyles: { fillColor: [185, 28, 28], textColor: 255 }
        });
        aposTabela();
      } else {
        paragrafo('Nenhum volume está preso por outro produto ou grade. O recebimento pode montar os paletes à medida que retira os volumes.', 8.5, [21, 128, 61]);
      }
    }

    /* ---------- VISTAS 3D ---------- */
    novaPagina();
    secao('Vistas do plano de carga');
    vistas.forEach(v => {
      const wMm = v.larguraMm, hMm = wMm * v.h / v.w;
      garantir(hMm + 14);
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); pdf.setTextColor(...ESC);
      pdf.text(v.titulo, M, y);
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7.5); pdf.setTextColor(...CINZA);
      pdf.text(v.legenda, M, y + 4);
      const x = M + (CW - wMm) / 2;
      pdf.setDrawColor(203, 213, 225);
      pdf.rect(x - 0.3, y + 6.7, wMm + 0.6, hMm + 0.6);
      pdf.addImage(v.data, 'JPEG', x, y + 7, wMm, hMm);
      y += hMm + 13;
    });

    // Legenda de cores
    garantir(14 + gradeProd.length * 5);
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); pdf.setTextColor(...ESC);
    pdf.text('Legenda de cores', M, y); y += 5;
    gradeProd.forEach(g => {
      pdf.setFillColor(...hexRgb(g.item.corHex)); pdf.roundedRect(M, y - 3, 4, 4, 0.7, 0.7, 'F');
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(...ESC);
      pdf.text(`${g.item.produto.codigo} - ${g.item.produto.descricao}  (Grade: ${g.item.produto.grade || 'Única'})`, M + 7, y);
      y += 5;
    });
    y += 4;

    /* ---------- ROTEIRO DE DESCARGA ---------- */
    novaPagina();
    secao('Roteiro de descarga por etapas');
    paragrafo(lateral
      ? 'Descarga LATERAL: abra as cortinas dos dois lados. Cada volume indica o lado de saída mais livre. Retire sempre do topo da pilha para baixo e só avance para a etapa seguinte quando a anterior estiver concluída.'
      : 'Descarga PELO FUNDO: retire os volumes a partir das portas traseiras, da etapa 1 em diante. Retire sempre do topo da pilha para baixo; os volumes da etapa N só ficam acessíveis após a etapa N-1.');

    const porEtapa = {};
    Object.values(analise).forEach(a => { (porEtapa[a.etapa] = porEtapa[a.etapa] || []).push(a); });
    const linhasEtapa = Object.keys(porEtapa).map(Number).sort((a, b) => a - b).map(e => {
      const cont = {};
      volumesNoCarro.forEach(v => { if (analise[v.uid].etapa === e) { const k = nomeProd(v); cont[k] = (cont[k] || 0) + 1; } });
      return [`Etapa ${e}`, porEtapa[e].length, Object.entries(cont).map(([k, q]) => `${k}: ${q}`).join('   |   ')];
    });
    pdf.autoTable({
      ...base, startY: y,
      head: [['Etapa', 'Volumes liberados', 'Produtos / grades liberados']],
      body: linhasEtapa,
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 22 }, 1: { halign: 'center', cellWidth: 32 } }
    });
    aposTabela();

    secao('Orientações ao recebimento');
    paragrafo('1) Monte os paletes à medida que os volumes de cada produto/grade forem liberados, conforme a norma de paletização cadastrada.');
    paragrafo('2) Volumes marcados na coluna "Bloq." do mapa abaixo exigem a retirada prévia de volumes de outro produto/grade: separe-os em área provisória e reavalie o plano de carga com o fornecedor.');
    paragrafo('3) Confira a etiqueta de cada volume (código, grade, volume e jogo) antes de paletizar. Respeite o empilhamento máximo e a altura do veículo informados neste relatório.');
    if (dados.obs) { paragrafo('Observações do planejador:', 8.5, CINZA); paragrafo(dados.obs); }

    /* ---------- MAPA DETALHADO ---------- */
    novaPagina();
    secao('Mapa detalhado de volumes');
    const ordenados = [...volumesNoCarro].sort((a, b) => {
      const A = analise[a.uid], B2 = analise[b.uid];
      if (A.etapa !== B2.etapa) return A.etapa - B2.etapa;
      return lateral ? a.pos.x - b.pos.x : b.pos.x - a.pos.x;
    });
    const ladoDe = v => (v.pos.z > veiculoAtual.largura / 6 ? 'Esquerdo' : v.pos.z < -veiculoAtual.largura / 6 ? 'Direito' : 'Centro');
    pdf.autoTable({
      ...base, startY: y,
      head: [['#', 'Produto / Grade', 'Jogo', 'Volume', 'Cabine (m)', 'Lado', 'Nível', 'Peso (kg)', 'Etapa', 'Saída', 'Bloq.']],
      body: ordenados.map((v, i) => {
        const a = analise[v.uid];
        return [i + 1, nomeProd(v), v.jogoNum, `${v.volNum} - ${v.volDesc}`, fmt(v.pos.x + veiculoAtual.comprimento / 2, 2), ladoDe(v), a.nivel, fmt(v.peso), a.etapa, a.saidaLabel.replace('Lateral esquerda', 'Lat. esq.').replace('Lateral direita', 'Lat. dir.').replace(' (portas)', ''), a.outros || '-'];
      }),
      styles: { ...base.styles, fontSize: 7, cellPadding: 1.4 },
      columnStyles: {
        0: { cellWidth: 8, halign: 'center' },
        1: { cellWidth: 38, cellPadding: { top: 1.4, bottom: 1.4, left: 6, right: 1.4 } },
        2: { cellWidth: 9, halign: 'center' }, 3: { cellWidth: 31 },
        4: { cellWidth: 15, halign: 'right' }, 5: { cellWidth: 15 }, 6: { cellWidth: 9, halign: 'center' },
        7: { cellWidth: 14, halign: 'right' }, 8: { cellWidth: 10, halign: 'center' }, 9: { cellWidth: 17 }, 10: { cellWidth: 10, halign: 'center' }
      },
      didParseCell: d => {
        if (d.section === 'body' && d.column.index === 10 && d.cell.raw !== '-') { d.cell.styles.textColor = [185, 28, 28]; d.cell.styles.fontStyle = 'bold'; }
      },
      didDrawCell: d => {
        if (d.section === 'body' && d.column.index === 1) {
          pdf.setFillColor(...hexRgb(ordenados[d.row.index].corHex));
          pdf.roundedRect(d.cell.x + 1.4, d.cell.y + (d.cell.height - 3) / 2, 3, 3, 0.5, 0.5, 'F');
        }
      }
    });

    /* ---------- RODAPÉ EM TODAS AS PÁGINAS ---------- */
    const total = pdf.getNumberOfPages();
    for (let i = 1; i <= total; i++) {
      pdf.setPage(i);
      pdf.setDrawColor(203, 213, 225); pdf.line(M, H - 12, W - M, H - 12);
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7.5); pdf.setTextColor(...CINZA);
      pdf.text(`LogiPalete | Documento ${numDoc} | Gerado automaticamente em ${dataStr}`, M, H - 7.5);
      pdf.text(`Página ${i} de ${total}`, W - M, H - 7.5, { align: 'right' });
    }

    const nome = `Plano_Carregamento_${numDoc}.pdf`;
    if (compartilhar && navigator.canShare) {
      const arquivo = new File([pdf.output('blob')], nome, { type: 'application/pdf' });
      if (navigator.canShare({ files: [arquivo] })) {
        try { await navigator.share({ files: [arquivo], title: 'Plano de carregamento', text: `Plano de carregamento ${numDoc}` }); mostrarMsg('PDF compartilhado.', 'ok'); }
        catch (err) { if (err.name !== 'AbortError') throw err; }
        return;
      }
    }
    pdf.save(nome);
    mostrarMsg('PDF gerado com sucesso!', 'ok');
  } catch (err) {
    console.error(err);
    mostrarMsg('Erro ao gerar o PDF: ' + err.message, 'erro');
  }
};

/* =====================================================================
   SALVAR PADRÃO NO BANCO (aprendizado futuro)
   ===================================================================== */
window.salvarModeloCarregamentoBD = async function () {
  if (volumesNoCarro.length === 0) return mostrarMsg('Nenhum volume no carro para salvar!', 'warn');

  const st = calcularEstatisticas();
  const modeloData = {
    dataCriacao: new Date().toISOString(),
    veiculo: veiculoAtual,
    quantidadeVolumes: volumesNoCarro.length,
    pesoTotal: st.pesoTotal,
    ocupacaoPct: st.ocupPct,
    descarga: resumoAnalise ? { tipo: resumoAnalise.tipoDescarga, volumesPresosPorOutroProduto: resumoAnalise.comBloqueio, pctLivres: resumoAnalise.pctLimpa, etapas: resumoAnalise.etapas } : null,
    disposicaoVolumes: volumesNoCarro.map(v => ({
      codigo: v.codigo,
      grade: v.grade,
      volNum: v.volNum,
      jogoNum: v.jogoNum,
      posicaoX: v.pos.x,
      posicaoY: v.pos.y,
      posicaoZ: v.pos.z,
      dimX: v.dim.x,
      dimY: v.dim.y,
      dimZ: v.dim.z,
      rotacaoX: v.rot.x,
      rotacaoY: v.rot.y,
      rotacaoZ: v.rot.z,
      etapaDescarga: analise[v.uid] ? analise[v.uid].etapa : null
    }))
  };

  try {
    await addDoc(collection(db, "modelos_carregamento"), modeloData);
    mostrarMsg('Modelo de carregamento salvo no banco com sucesso!', 'ok');
  } catch (e) {
    console.error(e);
    mostrarMsg('Não foi possível salvar no banco: ' + e.message, 'erro');
  }
};

carregarSelectsSimulacao();