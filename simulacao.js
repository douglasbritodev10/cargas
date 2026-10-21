import { db, collection, getDocs, doc, getDoc } from './firebase.js';

let produtosDisponiveisCache = [];
let volumesPatio = [];
let volumesNoCarro = [];
let veiculoAtual = null;
let itensSimulacaoCache = [];
let volumeSelecionadoUID = null;

// Three.js e Dragging
let scene, camera, renderer, controls;
let truckContainerGroup, meshesInTruck = [];
let raycaster, mouse;
let planeGround, isDragging = false, dragMesh = null;
let dragOffset = new THREE.Vector3();

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
  if (!container) return;
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

  const CORES_PALETA = [0x0284c7, 0x10b981, 0xf59e0b, 0x8b5cf6, 0xec4899, 0x06b6d4, 0xef4444];
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
      volumesDoJogo: volumesDoJogo
    });

    for (let j = 1; j <= qtdJogos; j++) {
      volumesDoJogo.forEach(v => {
        volumesPatio.push({
          uid: 'vol-' + Math.random().toString(36).substr(2, 9),
          prodId: prodObj.id,
          codigo: prodObj.codigo,
          descricaoProd: prodObj.descricao,
          grade: prodObj.grade || 'Padrão',
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
};

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
  ctx.fillText(`${vol.codigo}`, 16, 32);

  ctx.font = '14px Arial';
  ctx.fillText(`Grade: ${vol.grade}`, 16, 56);
  ctx.fillText(`Vol: ${vol.volNum} (${vol.volDesc})`, 16, 78);
  ctx.fillText(`Jogo ${vol.jogoNum} - ${vol.peso} kg`, 16, 100);

  return new THREE.CanvasTexture(canvas);
}

function inicializarCenarioThreeJS() {
  const container = document.getElementById('canvas-3d-viewport');
  container.innerHTML = '';

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x090d16);

  camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 1000);
  camera.position.set(veiculoAtual.comprimento * 1.1, veiculoAtual.altura * 2.5, veiculoAtual.largura * 2.5);

  renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.shadowMap.enabled = true;
  container.appendChild(renderer.domElement);

  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;

  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();

  // Plano invisível no piso para auxiliar o Drag & Drop 3D
  const planeGeo = new THREE.PlaneGeometry(100, 100);
  planeGeo.rotateX(-Math.PI / 2);
  const planeMat = new THREE.MeshBasicMaterial({ visible: false });
  planeGround = new THREE.Mesh(planeGeo, planeMat);
  scene.add(planeGround);

  // Eventos para Arrastar e Soltar (Drag and Drop 3D)
  renderer.domElement.addEventListener('pointerdown', onPointerDown, false);
  renderer.domElement.addEventListener('pointermove', onPointerMove, false);
  renderer.domElement.addEventListener('pointerup', onPointerUp, false);

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

  // Piso
  const floorGeo = new THREE.BoxGeometry(comp, 0.08, larg);
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.8 });
  const floorMesh = new THREE.Mesh(floorGeo, floorMat);
  floorMesh.position.set(0, 0, 0);
  truckContainerGroup.add(floorMesh);

  // Caçamba Transparente
  const boxGeo = new THREE.BoxGeometry(comp, alt, larg);
  const wireMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, wireframe: true, transparent: true, opacity: 0.35 });
  const wireMesh = new THREE.Mesh(boxGeo, wireMat);
  wireMesh.position.set(0, alt / 2, 0);
  truckContainerGroup.add(wireMesh);

  // Cabine
  const cabGeo = new THREE.BoxGeometry(1.2, alt * 0.9, larg);
  const cabMat = new THREE.MeshStandardMaterial({ color: 0x0284c7 });
  const cabMesh = new THREE.Mesh(cabGeo, cabMat);
  cabMesh.position.set(-comp / 2 - 0.6, alt * 0.45, 0);
  truckContainerGroup.add(cabMesh);
}

// Drag & Drop no 3D
function getMousePos(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

function onPointerDown(event) {
  if (event.button !== 0) return; // Apenas clique esquerdo
  getMousePos(event);

  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(meshesInTruck);

  if (intersects.length > 0) {
    dragMesh = intersects[0].object;
    volumeSelecionadoUID = dragMesh.userData.uid;
    isDragging = true;
    controls.enabled = false; // Desativa a rotação de câmera durante o drag

    const planeIntersect = raycaster.intersectObject(planeGround);
    if (planeIntersect.length > 0) {
      dragOffset.copy(planeIntersect[0].point).sub(dragMesh.position);
    }
  } else {
    volumeSelecionadoUID = null;
  }

  renderizerVolumes3DNaCena();
  renderizarPainelInspecao();
}

function onPointerMove(event) {
  if (!isDragging || !dragMesh) return;
  getMousePos(event);

  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObject(planeGround);

  if (intersects.length > 0) {
    const vol = volumesNoCarro.find(v => v.uid === dragMesh.userData.uid);
    if (!vol) return;

    const newPos = intersects[0].point.sub(dragOffset);
    vol.pos.x = newPos.x;
    vol.pos.z = newPos.z;

    // Recalcula o empilhamento (Snap de Altura Y)
    recalcularEmpilhamentoVolume(vol);
    validarLimitesVeiculo(vol);

    dragMesh.position.set(vol.pos.x, vol.pos.y, vol.pos.z);
    calcularBalancoPeso3D();
  }
}

function onPointerUp() {
  if (isDragging) {
    isDragging = false;
    dragMesh = null;
    controls.enabled = true;
    renderizerVolumes3DNaCena();
    renderizarPainelInspecao();
  }
}

function recalcularEmpilhamentoVolume(vol) {
  let maxBaseY = 0.04; // Nível do chão

  volumesNoCarro.forEach(outro => {
    if (outro.uid === vol.uid) return;

    const sobreposicaoX = Math.abs(outro.pos.x - vol.pos.x) < (outro.prof / 2 + vol.prof / 2) - 0.05;
    const sobreposicaoZ = Math.abs(outro.pos.z - vol.pos.z) < (outro.largura / 2 + vol.largura / 2) - 0.05;

    if (sobreposicaoX && sobreposicaoZ) {
      const topoOutro = outro.pos.y + (outro.altura / 2);
      if (topoOutro > maxBaseY) {
        maxBaseY = topoOutro;
      }
    }
  });

  vol.pos.y = maxBaseY + (vol.altura / 2);
}

function validarLimitesVeiculo(vol) {
  const meioComp = veiculoAtual.comprimento / 2;
  const meioLarg = veiculoAtual.largura / 2;

  if (vol.pos.x - (vol.prof / 2) < -meioComp) vol.pos.x = -meioComp + (vol.prof / 2);
  if (vol.pos.x + (vol.prof / 2) > meioComp) vol.pos.x = meioComp - (vol.prof / 2);

  if (vol.pos.z - (vol.largura / 2) < -meioLarg) vol.pos.z = -meioLarg + (vol.largura / 2);
  if (vol.pos.z + (vol.largura / 2) > meioLarg) vol.pos.z = meioLarg - (vol.largura / 2);

  if (vol.pos.y + (vol.altura / 2) > veiculoAtual.altura) {
    vol.pos.y = veiculoAtual.altura - (vol.altura / 2);
  }
}

// Inserção automática inteligente
window.adicionarVolumeAoVeiculoInteligente = function(uid) {
  const idx = volumesPatio.findIndex(v => v.uid === uid);
  if (idx === -1) return;

  const vol = volumesPatio.splice(idx, 1)[0];
  
  vol.pos.x = -veiculoAtual.comprimento / 2 + (vol.prof / 2) + 0.1;
  vol.pos.z = 0;

  recalcularEmpilhamentoVolume(vol);
  validarLimitesVeiculo(vol);

  volumesNoCarro.push(vol);
  volumeSelecionadoUID = vol.uid;

  renderizerVolumes3DNaCena();
  atualizarPatioEDock();
  atualizarContadoresProgresso();
  calcularBalancoPeso3D();
  renderizarPainelInspecao();
};

window.carregarBlocoInteiro = function(codigo, volNum) {
  const paraMover = volumesPatio.filter(v => v.codigo === codigo && v.volNum === volNum);
  paraMover.forEach(v => adicionarVolumeAoVeiculoInteligente(v.uid));
};

window.retornarVolumeAoPatio = function(uid) {
  const idx = volumesNoCarro.findIndex(v => v.uid === uid);
  if (idx === -1) return;

  const vol = volumesNoCarro.splice(idx, 1)[0];
  volumesPatio.push(vol);

  if (volumeSelecionadoUID === uid) volumeSelecionadoUID = null;

  renderizerVolumes3DNaCena();
  atualizarPatioEDock();
  atualizarContadoresProgresso();
  calcularBalancoPeso3D();
  renderizarPainelInspecao();
};

window.ajustarPosicaoVolume = function(eixo, delta) {
  if (!volumeSelecionadoUID) return;
  const vol = volumesNoCarro.find(v => v.uid === volumeSelecionadoUID);
  if (!vol) return;

  vol.pos[eixo] += delta;

  if (eixo === 'x' || eixo === 'z') recalcularEmpilhamentoVolume(vol);
  validarLimitesVeiculo(vol);

  renderizerVolumes3DNaCena();
  calcularBalancoPeso3D();
};

window.rotacionarVolumeSelecionado = function(eixo, angulo) {
  if (!volumeSelecionadoUID) return;
  const vol = volumesNoCarro.find(v => v.uid === volumeSelecionadoUID);
  if (!vol) return;

  vol.rot[eixo] += angulo;
  renderizerVolumes3DNaCena();
};

function renderizerVolumes3DNaCena() {
  meshesInTruck.forEach(mesh => truckContainerGroup.remove(mesh));
  meshesInTruck = [];

  volumesNoCarro.forEach(vol => {
    const geo = new THREE.BoxGeometry(vol.prof, vol.altura, vol.largura);
    const texture = criarTexturaEtiqueta(vol);

    const matCor = new THREE.MeshStandardMaterial({ color: vol.corHex, roughness: 0.4 });
    const matEtiqueta = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.3 });

    // Materiais em cada face (Etiqueta nas faces frontais/traseiras para fácil leitura)
    const materials = [matCor, matCor, matCor, matCor, matEtiqueta, matEtiqueta];

    const mesh = new THREE.Mesh(geo, materials);
    mesh.position.set(vol.pos.x, vol.pos.y, vol.pos.z);
    mesh.rotation.set(vol.rot.x, vol.rot.y, vol.rot.z);

    if (vol.uid === volumeSelecionadoUID) {
      const edgesGeo = new THREE.EdgesGeometry(geo);
      const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: 3 });
      const wireframe = new THREE.LineSegments(edgesGeo, lineMat);
      mesh.add(wireframe);
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
    dock.innerHTML = `<p style="font-size:0.8rem; color:#64748b; text-align:center; padding:15px;">Todos os volumes foram carregados na caçamba!</p>`;
    return;
  }

  // Agrupa os volumes no pátio em blocos homogêneos
  const grupos = {};
  volumesPatio.forEach(v => {
    const chave = `${v.codigo}_${v.volNum}`;
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
      <strong style="color:#0f172a;">${primeiro.codigo} - Grade: ${primeiro.grade}</strong><br>
      <span style="font-size:0.75rem; color:#0284c7; font-weight:bold;">Vol ${primeiro.volNum}: ${primeiro.volDesc}</span><br>
      <small>Disponível no pátio: <strong>${lista.length} bloco(s)</strong></small><br>
      <small>Dim: ${primeiro.prof}m(C) x ${primeiro.largura}m(L) x ${primeiro.altura}m(A) | ${primeiro.peso}kg</small>
      <div style="margin-top: 6px; display:flex; gap:5px;">
        <button class="btn-primary" style="padding: 3px 6px; font-size: 0.7rem; flex:1;" onclick="adicionarVolumeAoVeiculoInteligente('${primeiro.uid}')">➕ Mover 1 Unid.</button>
        <button class="btn-secondary" style="padding: 3px 6px; font-size: 0.7rem;" onclick="carregarBlocoInteiro('${primeiro.codigo}', '${primeiro.volNum}')">📦 Mover Bloco (${lista.length})</button>
      </div>
    `;
    dock.appendChild(card);
  });
}

function renderizarPainelInspecao() {
  const container = document.getElementById('conteudo-painel-inspecao');
  if (!container) return;
  
  if (!volumeSelecionadoUID) {
    container.innerHTML = `<p style="font-size: 0.8rem; color: #64748b;">Nenhuma caixa selecionada. Clique ou arraste qualquer caixa na caçamba 3D para ajustá-la.</p>`;
    return;
  }

  const vol = volumesNoCarro.find(v => v.uid === volumeSelecionadoUID);
  if (!vol) return;

  container.innerHTML = `
    <div style="background:#fff; padding:10px; border-radius:6px; border-left: 4px solid #${vol.corHex.toString(16).padStart(6, '0')}; margin-bottom:12px;">
      <strong style="color: #0284c7;">📦 ${vol.codigo} - ${vol.descricaoProd}</strong><br>
      <span style="font-size:0.8rem;">Jogo nº ${vol.jogoNum} | Vol: <strong>${vol.volNum} (${vol.volDesc})</strong></span><br>
      <small>Grade: ${vol.grade} | Peso: <strong>${vol.peso} kg</strong></small><br>
      <small>Dimensões reais: C: ${vol.prof}m | L: ${vol.largura}m | A: ${vol.altura}m</small>
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

    <h5 style="font-size:0.8rem; margin-bottom:6px;">🔄 Rotação 3D (Deitado / Em Pé):</h5>
    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:6px; margin-bottom:12px;">
      <button class="btn-secondary" style="font-size:0.75rem" onclick="rotacionarVolumeSelecionado('y', Math.PI/2)">🔄 Girar 90°</button>
      <button class="btn-secondary" style="font-size:0.75rem" onclick="rotacionarVolumeSelecionado('z', Math.PI/2)">📐 Deitar / Em pé</button>
    </div>

    <button class="btn-remove" style="width:100%; font-size:0.8rem; margin-top:8px;" onclick="retornarVolumeAoPatio('${vol.uid}')">🗑️ Retornar Volume ao Pátio</button>
  `;
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
        • <strong>${item.produto.codigo} - ${item.produto.descricao}</strong>: 
        <strong>${jogosCompletos} de ${totalJogos} Jogos Completos</strong> carregados (Volumes no carro: ${totalVolsNoCarro} / ${totalJogos * volsNoJogo})
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

carregarSelectsSimulacao();