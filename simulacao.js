import { db, collection, getDocs, doc, getDoc, addDoc } from './firebase.js';

let produtosDisponiveisCache = [];
let volumesPatio = [];
let volumesNoCarro = [];
let veiculoAtual = null;
let itensSimulacaoCache = [];
let volumeSelecionadoUID = null;

// Three.js & Controles
let scene, camera, renderer, controls;
let truckContainerGroup, meshesInTruck = [];
let raycaster, mouse;

// Variáveis de Interação de Arraste/Posicionamento em Bloco
let modoPosicionamentoAtivo = false;
let blocoEmTransito = []; // Volumes selecionados para posicionamento
let meshPreviewBloco = null;
let planoPisoRaycast = null;

async function carregarSelectsSimulacao() {
  const prodsSnap = await getDocs(collection(db, "produtos"));
  produtosDisponiveisCache = [];
  prodsSnap.forEach(d => {
    produtosDisponiveisCache.push({ id: d.id, ...d.data() });
  });

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

window.adicionarLinhaSimulacao = function() {
  const container = document.getElementById('simulacao-produtos-container');
  const linhaId = 'sim-prod-row-' + Date.now();
  
  const div = document.createElement('div');
  div.className = 'form-grid';
  div.style.marginBottom = '10px';
  div.id = linhaId;

  let optionsHtml = '<option value="">Selecione o Produto (Código - Descrição)</option>';
  produtosDisponiveisCache.forEach(p => {
    const gradeStr = p.grade ? ` | Grade: ${p.grade}` : '';
    optionsHtml += `<option value="${p.id}">${p.codigo} - ${p.descricao}${gradeStr}</option>`;
  });

  div.innerHTML = `
    <div class="field" style="grid-column: span 3;">
      <label>Produto e Grade</label>
      <select class="sim-prod-select" required>${optionsHtml}</select>
    </div>
    <div class="field">
      <label>Qtd de Jogos (Kits)</label>
      <input type="number" class="sim-prod-qtd" value="3" min="1" required>
    </div>
    <div class="field" style="display: flex; align-items: flex-end;">
      <button type="button" class="btn-remove" onclick="document.getElementById('${linhaId}').remove()">Remover</button>
    </div>
  `;
  container.appendChild(div);
};

window.iniciarMontagemProfissional = async function() {
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

    itensSimulacaoCache.push({
      produto: prodObj,
      qtdJogosTotal: qtdJogos,
      volumesDoJogo: volumesDoJogo,
      corHex: corHex
    });

    for (let j = 1; j <= qtdJogos; j++) {
      volumesDoJogo.forEach(v => {
        volumesPatio.push({
          uid: 'vol-' + Math.random().toString(36).substr(2, 9),
          prodId: prodObj.id,
          codigo: prodObj.codigo,
          descricaoProd: prodObj.descricao,
          grade: prodObj.grade || 'Única',
          jogoNum: j,
          volNum: v.numero,
          volDesc: v.descricao,
          largura: parseFloat(v.largura) || 0.6,  // Z
          altura: parseFloat(v.altura) || 0.4,   // Y
          prof: parseFloat(v.prof) || 1.2,      // X
          peso: parseFloat(v.peso) || 15,
          corHex: corHex,
          pos: { x: 0, y: 0, z: 0 },
          rot: { x: 0, y: 0, z: 0 }
        });
      });
    }
  }

  if (volumesPatio.length === 0) return alert("Selecione produtos válidos!");

  document.getElementById('area-montagem-3d').classList.remove('hidden');
  
  inicializarCenarioThreeJS();
  atualizarPatioEDock();
  atualizarContadoresProgresso();
  calcularBalancoPeso3D();
  renderizarPainelInspecao();
  gerarLegendaCoresAbil();
};

function inicializarCenarioThreeJS() {
  const container = document.getElementById('canvas-3d-viewport');
  container.innerHTML = '';

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x090d16);

  camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 1000);
  // Posição inicial permitindo ver a frente do veículo claramente
  camera.position.set(veiculoAtual.comprimento * 1.2, veiculoAtual.altura * 2.2, veiculoAtual.largura * 2.2);

  renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.shadowMap.enabled = true;
  container.appendChild(renderer.domElement);

  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.maxPolarAngle = Math.PI; // Permite giro livre sem travar o teto/frente

  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();

  // Eventos para clique e movimento do mouse para posicionamento de bloco
  renderer.domElement.addEventListener('mousemove', onCanvasMouseMove, false);
  renderer.domElement.addEventListener('click', onCanvasClick, false);

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
  scene.add(ambientLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(20, 40, 20);
  scene.add(dirLight);

  const gridHelper = new THREE.GridHelper(30, 30, 0x0284c7, 0x334155);
  gridHelper.position.y = -0.01;
  scene.add(gridHelper);

  truckContainerGroup = new THREE.Group();
  scene.add(truckContainerGroup);

  construirEstruturaCaminhao3D();

  // Mesh invisível para capturar a posição X, Z do mouse no piso do caminhão
  const planeGeo = new THREE.PlaneGeometry(veiculoAtual.comprimento, veiculoAtual.largura);
  planeGeo.rotateX(-Math.PI / 2);
  const planeMat = new THREE.MeshBasicMaterial({ visible: false });
  planoPisoRaycast = new THREE.Mesh(planeGeo, planeMat);
  planoPisoRaycast.position.y = 0.04;
  truckContainerGroup.add(planoPisoRaycast);

  function renderLoop() {
    requestAnimationFrame(renderLoop);
    controls.update();
    renderer.render(scene, camera);
  }
  renderLoop();
}

function construirEstruturaCaminhao3D() {
  const comp = veiculoAtual.comprimento;
  const larg = veiculoAtual.largura;
  const alt = veiculoAtual.altura;

  // Piso metálico
  const floorGeo = new THREE.BoxGeometry(comp, 0.08, larg);
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.8 });
  const floorMesh = new THREE.Mesh(floorGeo, floorMat);
  floorMesh.position.set(0, 0, 0);
  truckContainerGroup.add(floorMesh);

  // Paredes Transparentes do Baú/Sider (Para enxergar a frente e laterais sem obstrução)
  const boxGeo = new THREE.BoxGeometry(comp, alt, larg);
  const wireMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, wireframe: true, transparent: true, opacity: 0.25 });
  const wireMesh = new THREE.Mesh(boxGeo, wireMat);
  wireMesh.position.set(0, alt / 2, 0);
  truckContainerGroup.add(wireMesh);

  // Cabine Dianteira com Semitransparência (Visão da Frente Sem Barreiras)
  const cabGeo = new THREE.BoxGeometry(1.2, alt * 0.9, larg);
  const cabMat = new THREE.MeshStandardMaterial({ color: 0x0284c7, transparent: true, opacity: 0.4 });
  const cabMesh = new THREE.Mesh(cabGeo, cabMat);
  cabMesh.position.set(-comp / 2 - 0.6, alt * 0.45, 0);
  truckContainerGroup.add(cabMesh);
}

// Atualização do indicador preview ao mover o mouse
function onCanvasMouseMove(event) {
  if (!modoPosicionamentoAtivo || !meshPreviewBloco) return;

  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects([planoPisoRaycast, ...meshesInTruck]);

  if (intersects.length > 0) {
    const pt = intersects[0].point;

    // Converte para o sistema de coordenadas local do caminhão
    let localX = pt.x;
    let localZ = pt.z;

    // Respeita as dimensões do veículo
    const meioComp = veiculoAtual.comprimento / 2;
    const meioLarg = veiculoAtual.largura / 2;

    const tamX = meshPreviewBloco.userData.tamX;
    const tamZ = meshPreviewBloco.userData.tamZ;

    if (localX - tamX / 2 < -meioComp) localX = -meioComp + tamX / 2;
    if (localX + tamX / 2 > meioComp) localX = meioComp - tamX / 2;

    if (localZ - tamZ / 2 < -meioLarg) localZ = -meioLarg + tamZ / 2;
    if (localZ + tamZ / 2 > meioLarg) localZ = meioLarg - tamZ / 2;

    // Calcula a altura de empilhamento no ponto indicado
    let maxAltitude = 0.04;
    volumesNoCarro.forEach(outraBox => {
      const colideX = Math.abs(outraBox.pos.x - localX) < (outraBox.prof / 2 + tamX / 2);
      const colideZ = Math.abs(outraBox.pos.z - localZ) < (outraBox.largura / 2 + tamZ / 2);
      if (colideX && colideZ) {
        const topo = outraBox.pos.y + outraBox.altura / 2;
        if (topo > maxAltitude) maxAltitude = topo;
      }
    });

    meshPreviewBloco.position.set(localX, maxAltitude + meshPreviewBloco.userData.tamY / 2, localZ);
  }
}

// Ação de clique: Selecionar caixa ou Posicionar Bloco Alvo
function onCanvasClick(event) {
  if (modoPosicionamentoAtivo && meshPreviewBloco) {
    // Confirma o posicionamento do bloco na posição exata clicada
    finalizarPosicionamentoBloco(meshPreviewBloco.position.x, meshPreviewBloco.position.y, meshPreviewBloco.position.z);
    return;
  }

  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(meshesInTruck);

  if (intersects.length > 0) {
    const clickedMesh = intersects[0].object;
    volumeSelecionadoUID = clickedMesh.userData.uid;
  } else {
    volumeSelecionadoUID = null;
  }

  renderizarVolumes3DNaCena();
  renderizarPainelInspecao();
}

// Inicia modo de direcionamento por clique no caminhão
window.prepararMovimentoBloco = function(prodId, volNum, qtdDesejada) {
  const candidatos = volumesPatio.filter(v => v.prodId === prodId && v.volNum === volNum);
  if (candidatos.length === 0) return;

  const qtdReal = Math.min(qtdDesejada, candidatos.length);
  blocoEmTransito = candidatos.slice(0, qtdReal);

  const ref = blocoEmTransito[0];
  const tamX = ref.prof;
  const tamZ = ref.largura;
  const tamY = ref.altura * qtdReal; // Empilhamento vertical do bloco

  // Cria preview transparente do bloco
  if (meshPreviewBloco) scene.remove(meshPreviewBloco);

  const previewGeo = new THREE.BoxGeometry(tamX, tamY, tamZ);
  const previewMat = new THREE.MeshStandardMaterial({
    color: 0x10b981,
    transparent: true,
    opacity: 0.5,
    wireframe: false
  });

  meshPreviewBloco = new THREE.Mesh(previewGeo, previewMat);
  meshPreviewBloco.userData = { tamX, tamY, tamZ, qtdReal };
  scene.add(meshPreviewBloco);

  modoPosicionamentoAtivo = true;
  alert(`Clique no local desejado dentro do caminhão para descarregar o bloco (${qtdReal} volumes)!`);
};

function finalizarPosicionamentoBloco(posX, posYBase, posZ) {
  if (!blocoEmTransito || blocoEmTransito.length === 0) return;

  const ref = blocoEmTransito[0];
  const altUnid = ref.altura;

  blocoEmTransito.forEach((vol, idx) => {
    const pIdx = volumesPatio.findIndex(v => v.uid === vol.uid);
    if (pIdx !== -1) volumesPatio.splice(pIdx, 1);

    vol.pos.x = posX;
    vol.pos.z = posZ;
    vol.pos.y = (posYBase - (ref.altura * blocoEmTransito.length / 2)) + (idx * altUnid) + (altUnid / 2);

    volumesNoCarro.push(vol);
  });

  // Limpeza
  if (meshPreviewBloco) scene.remove(meshPreviewBloco);
  meshPreviewBloco = null;
  blocoEmTransito = [];
  modoPosicionamentoAtivo = false;

  renderizarVolumes3DNaCena();
  atualizarPatioEDock();
  atualizarContadoresProgresso();
  calcularBalancoPeso3D();
  renderizarPainelInspecao();
}

function criarTexturaEtiqueta(vol) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = `#${vol.corHex.toString(16).padStart(6, '0')}`;
  ctx.fillRect(0, 0, 256, 128);

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(8, 8, 240, 112);

  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 20px Arial';
  ctx.fillText(`${vol.codigo}`, 15, 35);
  ctx.font = '14px Arial';
  ctx.fillText(`Grade: ${vol.grade}`, 15, 60);
  ctx.fillText(`VOL: ${vol.volNum} (${vol.volDesc})`, 15, 82);
  ctx.fillText(`Jogo ${vol.jogoNum} - ${vol.peso}kg`, 15, 104);

  return new THREE.CanvasTexture(canvas);
}

function renderizarVolumes3DNaCena() {
  meshesInTruck.forEach(mesh => truckContainerGroup.remove(mesh));
  meshesInTruck = [];

  volumesNoCarro.forEach(vol => {
    const geo = new THREE.BoxGeometry(vol.prof, vol.altura, vol.largura);
    const textureEtiqueta = criarTexturaEtiqueta(vol);

    const matCor = new THREE.MeshStandardMaterial({ color: vol.corHex, roughness: 0.4 });
    const matEtiqueta = new THREE.MeshStandardMaterial({ map: textureEtiqueta });

    // Aplica etiqueta na face frontal e traseira
    const materiais = [matCor, matCor, matCor, matCor, matEtiqueta, matEtiqueta];

    const mesh = new THREE.Mesh(geo, materiais);
    mesh.position.set(vol.pos.x, vol.pos.y, vol.pos.z);
    mesh.rotation.set(vol.rot.x, vol.rot.y, vol.rot.z);

    if (vol.uid === volumeSelecionadoUID) {
      const edgesGeo = new THREE.EdgesGeometry(geo);
      const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: 3 });
      mesh.add(new THREE.LineSegments(edgesGeo, lineMat));
    }

    mesh.userData = { uid: vol.uid };
    truckContainerGroup.add(mesh);
    meshesInTruck.push(mesh);
  });
}

function atualizarPatioEDock() {
  const dock = document.getElementById('dock-patio-volumes');
  if (!dock) return;

  dock.innerHTML = '';

  if (volumesPatio.length === 0) {
    dock.innerHTML = `<p style="font-size:0.8rem; color:#64748b; text-align:center; padding:15px;">Todos os volumes foram carregados!</p>`;
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
    card.style.borderLeft = `6px solid #${primeiro.corHex.toString(16).padStart(6, '0')}`;
    card.innerHTML = `
      <strong style="color:#0f172a;">${primeiro.codigo} - ${primeiro.descricaoProd}</strong><br>
      <span style="font-size:0.75rem; color:#0284c7; font-weight:bold;">Grade: ${primeiro.grade} | Vol ${primeiro.volNum}: ${primeiro.volDesc}</span><br>
      <small>Disponível no Pátio: <strong>${lista.length} un.</strong></small><br>
      
      <div style="margin-top: 8px; display:flex; align-items:center; gap:5px;">
        <input type="number" id="qtd-mover-${primeiro.prodId}-${primeiro.volNum}" value="${lista.length}" min="1" max="${lista.length}" style="width:50px; padding:3px; font-size:0.75rem;">
        <button class="btn-primary" style="padding: 3px 8px; font-size: 0.7rem; flex:1;" onclick="executarMovimentoInput('${primeiro.prodId}', '${primeiro.volNum}')">🎯 Escolher Posição no Carro</button>
      </div>
    `;
    dock.appendChild(card);
  });
}

window.executarMovimentoInput = function(prodId, volNum) {
  const input = document.getElementById(`qtd-mover-${prodId}-${volNum}`);
  const qtd = parseInt(input.value) || 1;
  prepararMovimentoBloco(prodId, volNum, qtd);
};

window.ajustarPosicaoVolume = function(eixo, delta) {
  if (!volumeSelecionadoUID) return;
  const vol = volumesNoCarro.find(v => v.uid === volumeSelecionadoUID);
  if (!vol) return;

  vol.pos[eixo] += delta;

  const meioComp = veiculoAtual.comprimento / 2;
  const meioLarg = veiculoAtual.largura / 2;
  const altMax = veiculoAtual.altura;

  if (vol.pos.x - (vol.prof/2) < -meioComp) vol.pos.x = -meioComp + (vol.prof/2);
  if (vol.pos.x + (vol.prof/2) > meioComp) vol.pos.x = meioComp - (vol.prof/2);

  if (vol.pos.z - (vol.largura/2) < -meioLarg) vol.pos.z = -meioLarg + (vol.largura/2);
  if (vol.pos.z + (vol.largura/2) > meioLarg) vol.pos.z = meioLarg - (vol.largura/2);

  if (vol.pos.y - (vol.altura/2) < 0.04) vol.pos.y = 0.04 + (vol.altura/2);
  if (vol.pos.y + (vol.altura/2) > altMax) vol.pos.y = altMax - (vol.altura/2);

  renderizarVolumes3DNaCena();
  calcularBalancoPeso3D();
};

window.rotacionarVolumeSelecionado = function(eixo, angulo) {
  if (!volumeSelecionadoUID) return;
  const vol = volumesNoCarro.find(v => v.uid === volumeSelecionadoUID);
  if (!vol) return;

  vol.rot[eixo] += angulo;
  renderizarVolumes3DNaCena();
};

function renderizarPainelInspecao() {
  const container = document.getElementById('conteudo-painel-inspecao');
  
  if (!volumeSelecionadoUID) {
    container.innerHTML = `<p style="font-size: 0.8rem; color: #64748b;">Clique em qualquer caixa no 3D para inspecioná-la ou ajustá-la.</p>`;
    return;
  }

  const vol = volumesNoCarro.find(v => v.uid === volumeSelecionadoUID);
  if (!vol) return;

  container.innerHTML = `
    <div style="background:#fff; padding:10px; border-radius:6px; border-left: 4px solid #${vol.corHex.toString(16).padStart(6, '0')}; margin-bottom:12px;">
      <strong style="color: #0284c7;">📦 ${vol.codigo} - ${vol.descricaoProd}</strong><br>
      <span style="font-size:0.8rem;">Grade: <strong>${vol.grade}</strong> | Jogo nº ${vol.jogoNum}</span><br>
      <small>Volume: <strong>${vol.volNum} (${vol.volDesc})</strong> | Peso: <strong>${vol.peso} kg</strong></small>
    </div>

    <h5 style="font-size:0.8rem; margin-bottom:6px;">📍 Ajuste Fino de Posição:</h5>
    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:6px; margin-bottom:12px;">
      <button class="btn-secondary" style="font-size:0.75rem" onclick="ajustarPosicaoVolume('x', -0.1)">⬅ Frente (-X)</button>
      <button class="btn-secondary" style="font-size:0.75rem" onclick="ajustarPosicaoVolume('x', 0.1)">Trás (+X) ➡</button>
      <button class="btn-secondary" style="font-size:0.75rem" onclick="ajustarPosicaoVolume('z', -0.1)">⬅ Esquerda (-Z)</button>
      <button class="btn-secondary" style="font-size:0.75rem" onclick="ajustarPosicaoVolume('z', 0.1)">Direita (+Z) ➡</button>
      <button class="btn-secondary" style="font-size:0.75rem" onclick="ajustarPosicaoVolume('y', 0.1)">⬆ Subir (+Y)</button>
      <button class="btn-secondary" style="font-size:0.75rem" onclick="ajustarPosicaoVolume('y', -0.1)">⬇ Descer (-Y)</button>
    </div>

    <h5 style="font-size:0.8rem; margin-bottom:6px;">🔄 Rotação 3D:</h5>
    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:6px; margin-bottom:12px;">
      <button class="btn-secondary" style="font-size:0.75rem" onclick="rotacionarVolumeSelecionado('y', Math.PI/2)">🔄 Girar 90°</button>
      <button class="btn-secondary" style="font-size:0.75rem" onclick="rotacionarVolumeSelecionado('z', Math.PI/2)">📐 Deitar / Em pé</button>
    </div>

    <button class="btn-remove" style="width:100%; font-size:0.8rem; margin-top:8px;" onclick="retornarVolumeAoPatio('${vol.uid}')">🗑️ Retornar Volume ao Pátio</button>
  `;
}

window.retornarVolumeAoPatio = function(uid) {
  const idx = volumesNoCarro.findIndex(v => v.uid === uid);
  if (idx === -1) return;

  const vol = volumesNoCarro.splice(idx, 1)[0];
  volumesPatio.push(vol);

  if (volumeSelecionadoUID === uid) volumeSelecionadoUID = null;

  renderizarVolumes3DNaCena();
  atualizarPatioEDock();
  atualizarContadoresProgresso();
  calcularBalancoPeso3D();
  renderizarPainelInspecao();
};

function gerarLegendaCoresAbil() {
  const container = document.getElementById('painel-legenda-cores');
  if (!container) return;

  let html = `<h4 style="font-size:0.9rem; color:#0284c7; margin-bottom:8px;">🎨 Legenda de Cores por Produto / Grade:</h4><div style="display:flex; flex-wrap:wrap; gap:10px;">`;

  itensSimulacaoCache.forEach(item => {
    const hex = `#${item.corHex.toString(16).padStart(6, '0')}`;
    html += `
      <div style="display:flex; align-items:center; gap:6px; background:#fff; padding:6px 10px; border-radius:5px; border:1px solid #cbd5e1; font-size:0.8rem;">
        <div style="width:16px; height:16px; background:${hex}; border-radius:3px;"></div>
        <span><strong>${item.produto.codigo}</strong> (${item.produto.grade || 'Padrão'})</span>
      </div>
    `;
  });

  html += `</div>`;
  container.innerHTML = html;
}

function atualizarContadoresProgresso() {
  const container = document.getElementById('lista-contadores-progresso');
  if (!container) return;

  let html = '';
  itensSimulacaoCache.forEach(item => {
    const totalJogos = item.qtdJogosTotal;
    const volsNoJogo = item.volumesDoJogo.length;

    let jogosCompletos = 0;
    for (let j = 1; j <= totalJogos; j++) {
      const volsNoCarro = volumesNoCarro.filter(v => v.prodId === item.produto.id && v.jogoNum === j);
      if (volsNoCarro.length === volsNoJogo) jogosCompletos++;
    }

    const totalVolsNoCarro = volumesNoCarro.filter(v => v.prodId === item.produto.id).length;

    html += `
      <div style="font-size: 0.85rem; margin-bottom: 4px;">
        • <strong>${item.produto.codigo} - ${item.produto.descricao}</strong> (Grade: ${item.produto.grade || 'Única'}): 
        <strong>${jogosCompletos} de ${totalJogos} Jogos Completos</strong> (${totalVolsNoCarro} de ${totalJogos * volsNoJogo} vol)
      </div>
    `;
  });

  container.innerHTML = html;
}

function calcularBalancoPeso3D() {
  let pesoFrente = 0, pesoMeio = 0, pesoTras = 0;
  let pesoEsq = 0, pesoDir = 0, pesoTotal = 0;

  const comp = veiculoAtual.comprimento;

  volumesNoCarro.forEach(v => {
    pesoTotal += v.peso;

    if (v.pos.x < -comp / 6) pesoFrente += v.peso;
    else if (v.pos.x > comp / 6) pesoTras += v.peso;
    else pesoMeio += v.peso;

    if (v.pos.z < 0) pesoEsq += v.peso;
    else pesoDir += v.peso;
  });

  const pF = pesoTotal ? Math.round((pesoFrente / pesoTotal) * 100) : 0;
  const pM = pesoTotal ? Math.round((pesoMeio / pesoTotal) * 100) : 0;
  const pT = pesoTotal ? Math.round((pesoTras / pesoTotal) * 100) : 0;
  const pE = pesoTotal ? Math.round((pesoEsq / pesoTotal) * 100) : 50;
  const pD = pesoTotal ? Math.round((pesoDir / pesoTotal) * 100) : 50;

  atualizarStat('stat-frente', `Frente: ${pesoFrente.toFixed(1)} kg (${pF}%)`, pF > 45);
  atualizarStat('stat-meio', `Centro: ${pesoMeio.toFixed(1)} kg (${pM}%)`, pM > 60);
  atualizarStat('stat-tras', `Trás: ${pesoTras.toFixed(1)} kg (${pT}%)`, pT > 45);
  atualizarStat('stat-lateral', `Esq: ${pE}% | Dir: ${pD}%`, Math.abs(pE - pD) > 20);
}

function atualizarStat(id, texto, alerta) {
  const el = document.getElementById(id);
  if (el) {
    el.innerText = texto;
    el.className = alerta ? 'weight-indicator weight-alert' : 'weight-indicator weight-ok';
  }
}

// Futuro Aprendizado e Inteligência Artificial: Salvar Padrão no Firebase
window.salvarModeloCarregamentoBD = async function() {
  if (volumesNoCarro.length === 0) return alert("Nenhum volume no carro para salvar!");

  const modeloData = {
    dataCriacao: new Date().toISOString(),
    veiculo: veiculoAtual,
    quantidadeVolumes: volumesNoCarro.length,
    disposicaoVolumes: volumesNoCarro.map(v => ({
      codigo: v.codigo,
      grade: v.grade,
      volNum: v.volNum,
      posicaoX: v.pos.x,
      posicaoY: v.pos.y,
      posicaoZ: v.pos.z,
      rotacaoX: v.rot.x,
      rotacaoY: v.rot.y,
      rotacaoZ: v.rot.z
    }))
  };

  await addDoc(collection(db, "modelos_carregamento"), modeloData);
  alert("Modelo de carregamento salvo no banco com sucesso! Ele será utilizado como padrão para a montagem inteligente.");
};

carregarSelectsSimulacao();