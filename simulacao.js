import { db, collection, getDocs, doc, getDoc } from './firebase.js';

let produtosDisponiveisCache = [];
let volumesDisponiveisPatio = [];
let volumesNoCaminhao = [];
let veiculoSelecionado = null;

let scene, camera, renderer, vehicleMesh;

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
      selVeic.innerHTML += `<option value="${d.id}">[${d.data().tipo}] ${d.data().nome} (${d.data().comprimento}m C x ${d.data().largura}m L)</option>`;
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
      <input type="number" class="sim-prod-qtd" value="5" min="1" required>
    </div>
    <div class="field" style="display: flex; align-items: flex-end;">
      <button type="button" class="btn-remove" onclick="document.getElementById('${linhaId}').remove()">Remover</button>
    </div>
  `;
  container.appendChild(div);
};

window.executarSimulacaoMultipla = async function() {
  const linhas = document.querySelectorAll('#simulacao-produtos-container > div');
  if (linhas.length === 0) return alert("Adicione produtos à simulação!");

  const veicId = document.getElementById('sim-veiculo').value;
  if (!veicId) return alert("Selecione um veículo!");

  const veicSnap = await getDoc(doc(db, "veiculos", veicId));
  veiculoSelecionado = veicSnap.data();

  volumesDisponiveisPatio = [];
  volumesNoCaminhao = [];
  let resumoPaletesHtml = "";
  const CORES_PALETA = ["#0284c7", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899", "#06b6d4"];

  let prodIndex = 0;
  for (let linha of linhas) {
    const prodId = linha.querySelector('.sim-prod-select').value;
    const qtdJogos = parseInt(linha.querySelector('.sim-prod-qtd').value) || 0;

    if (!prodId || qtdJogos <= 0) continue;

    const prodObj = produtosDisponiveisCache.find(p => p.id === prodId);
    if (!prodObj) continue;

    const corProduto = CORES_PALETA[prodIndex % CORES_PALETA.length];
    prodIndex++;

    const normaRef = prodObj.normasPaletizacao && prodObj.normasPaletizacao.length > 0 ? prodObj.normasPaletizacao[0] : { unificador: 'PALETE 1.60 X 1.60', jogosPorPalete: 10 };
    const jogosPorPalete = normaRef.jogosPorPalete || 10;
    const paletesFechados = Math.floor(qtdJogos / jogosPorPalete);
    const sobra = qtdJogos % jogosPorPalete;

    resumoPaletesHtml += `
      <div style="margin-bottom:8px; border-bottom:1px dashed #cbd5e1; padding-bottom:6px;">
        <strong>${prodObj.codigo} - ${prodObj.descricao}</strong> (${qtdJogos} jogos)<br>
        • Desmembramento Destino (${normaRef.unificador}): ${paletesFechados} paletes fechados + ${sobra > 0 ? `1 palete com ${sobra} jogos` : '0 sobra'}.
      </div>
    `;

    // Desmembra jogos e cria cada volume com cor e dimensões
    for (let j = 1; j <= qtdJogos; j++) {
      (prodObj.volumes || []).forEach(v => {
        volumesDisponiveisPatio.push({
          id: `vol-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
          prodCodigo: prodObj.codigo,
          jogoNum: j,
          volNumero: v.numero,
          descricao: v.descricao,
          largura: parseFloat(v.largura) || 0.5,
          altura: parseFloat(v.altura) || 0.5,
          prof: parseFloat(v.prof) || 0.5,
          peso: parseFloat(v.peso) || 10,
          cor: corProduto
        });
      });
    }
  }

  document.getElementById('area-simulacao').classList.remove('hidden');
  document.getElementById('sim-resumo').innerHTML = `
    <strong>Veículo:</strong> ${veiculoSelecionado.nome} (${veiculoSelecionado.tipo}) | Dimensões Úteis: ${veiculoSelecionado.comprimento}m C x ${veiculoSelecionado.largura}m L x ${veiculoSelecionado.altura}m A
  `;
  document.getElementById('sim-paletes-desmembramento').innerHTML = resumoPaletesHtml;

  renderizarPatio();
  inicializarCenario3D();
};

function renderizarPatio() {
  const container = document.getElementById('dock-patio-volumes');
  container.innerHTML = '';

  volumesDisponiveisPatio.forEach(vol => {
    const card = document.createElement('div');
    card.className = 'vol-card-dock';
    card.style.borderLeft = `5px solid ${vol.cor}`;
    card.innerHTML = `
      <strong>${vol.prodCodigo} (Jogo ${vol.jogoNum})</strong><br>
      Vol: ${vol.volNumero} - ${vol.descricao}<br>
      <small>Tam: ${vol.prof}m x ${vol.largura}m x ${vol.altura}m | <strong>${vol.peso} kg</strong></small><br>
      <button class="btn-primary" style="padding: 2px 8px; font-size: 0.7rem; margin-top: 5px;" onclick="carregarVolumeNoCaminhao('${vol.id}')">➕ Posicionar no Veículo</button>
    `;
    container.appendChild(card);
  });
}

window.carregarVolumeNoCaminhao = function(volId) {
  const idx = volumesDisponiveisPatio.findIndex(v => v.id === volId);
  if (idx === -1) return;

  const vol = volumesDisponiveisPatio.splice(idx, 1)[0];
  
  // Posicionamento sequencial no caminhão
  const posX = (volumesNoCaminhao.length * 0.6) - (veiculoSelecionado.comprimento / 2) + 0.5;
  vol.posicao = { x: posX, y: vol.altura / 2, z: 0 };
  
  volumesNoCaminhao.push(vol);
  
  renderizarPatio();
  adicionarBlocoAoCenario3D(vol);
  calcularBalançoPeso();
};

function inicializarCenario3D() {
  const container = document.getElementById('canvas-3d-container');
  container.innerHTML = '';

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0f172a);

  camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 1000);
  camera.position.set(veiculoSelecionado.comprimento * 1.2, 8, veiculoSelecionado.comprimento * 1.2);
  camera.lookAt(0, 0, 0);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  const light = new THREE.DirectionalLight(0xffffff, 1);
  light.position.set(10, 20, 10);
  scene.add(light);
  scene.add(new THREE.AmbientLight(0xffffff, 0.4));

  // Desenha a Caçamba do Veículo
  const comp = veiculoSelecionado.comprimento;
  const larg = veiculoSelecionado.largura;
  const alt = veiculoSelecionado.altura;

  const geo = new THREE.BoxGeometry(comp, alt, larg);
  const mat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, wireframe: true });
  vehicleMesh = new THREE.Mesh(geo, mat);
  scene.add(vehicleMesh);

  function animate() {
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
  }
  animate();
}

function adicionarBlocoAoCenario3D(vol) {
  const geo = new THREE.BoxGeometry(vol.prof, vol.altura, vol.largura);
  const mat = new THREE.MeshLambertMaterial({ color: vol.cor });
  const mesh = new THREE.Mesh(geo, mat);
  
  mesh.position.set(vol.posicao.x, vol.posicao.y - (veiculoSelecionado.altura/2), vol.posicao.z);
  scene.add(mesh);
}

function calcularBalançoPeso() {
  let pesoFrente = 0, pesoMeio = 0, pesoTras = 0;
  let pesoEsq = 0, pesoDir = 0, pesoTotal = 0;

  const comp = veiculoSelecionado.comprimento;
  const limFrente = comp / 6;
  const limTras = -comp / 6;

  volumesNoCaminhao.forEach(v => {
    const p = v.peso;
    pesoTotal += p;

    if (v.posicao.x > limFrente) pesoFrente += p;
    else if (v.posicao.x < limTras) pesoTras += p;
    else pesoMeio += p;

    if (v.posicao.z >= 0) pesoDir += p;
    else pesoEsq += p;
  });

  const percentF = pesoTotal ? Math.round((pesoFrente / pesoTotal) * 100) : 0;
  const percentM = pesoTotal ? Math.round((pesoMeio / pesoTotal) * 100) : 0;
  const percentT = pesoTotal ? Math.round((pesoTras / pesoTotal) * 100) : 0;

  atualizarElementoStat('stat-frente', `Frente: ${pesoFrente.toFixed(1)} kg (${percentF}%)`, percentF > 45);
  atualizarElementoStat('stat-meio', `Meio: ${pesoMeio.toFixed(1)} kg (${percentM}%)`, percentM > 60);
  atualizarElementoStat('stat-tras', `Trás: ${pesoTras.toFixed(1)} kg (${percentT}%)`, percentT > 45);
}

function atualizarElementoStat(id, texto, alerta) {
  const el = document.getElementById(id);
  el.innerText = texto;
  el.className = alerta ? 'weight-indicator weight-alert' : 'weight-indicator weight-ok';
}

window.trocarAba = function(aba) {
  if (aba === 'auto') {
    document.getElementById('aba-conteudo-auto').classList.remove('hidden');
    document.getElementById('aba-conteudo-3d').classList.add('hidden');
  } else {
    document.getElementById('aba-conteudo-auto').classList.add('hidden');
    document.getElementById('aba-conteudo-3d').classList.remove('hidden');
  }
};

window.resetarPosicoes3D = function() {
  executarSimulacaoMultipla();
};

carregarSelectsSimulacao();