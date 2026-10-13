# Combustíveis em Portugal

Site estático que compara o preço do Brent com o da gasolina 95 e do gasóleo em Portugal, semana a semana desde 2005.

## Como funciona
- `scripts/fetch_data.py` descarrega o Weekly Oil Bulletin (Comissão Europeia) e o Brent (FRED) e gera `site/dados/semanal.json`.
- `site/` é o site (HTML, CSS e JS), que lê esse ficheiro. Não há servidor nem base de dados.
- `.github/workflows/atualizar-e-publicar.yml` corre o script todos os dias, faz commit do JSON se houver dados novos e publica `site/` no GitHub Pages.

## Correr localmente
```
pip install -r requirements.txt
python scripts/fetch_data.py
cd site && python -m http.server 8000
```
Abrir http://localhost:8000.

## Publicar (uma só vez)
1. Criar um repositório **público** no GitHub e enviar este projeto para o ramo `main`.
2. Em *Settings → Pages → Build and deployment*, escolher **Source: GitHub Actions**.
3. Em *Actions*, correr "Atualizar dados e publicar" manualmente (*Run workflow*) para a primeira publicação.
4. Domínio próprio (opcional): *Settings → Pages → Custom domain*, e criar no DNS um registo CNAME para `<utilizador>.github.io`.

Se o script falhar (por exemplo, a fonte mudou de formato), o workflow fica vermelho e o site continua com os dados anteriores.
