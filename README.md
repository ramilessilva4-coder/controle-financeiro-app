# Controle Financeiro — app do celular

App instalável (PWA) do Controle Financeiro: salgados, serviços e contas a receber, com os mesmos dados do programa do PC, em tempo real.

- **Dados:** ficam no Supabase. Este repositório não contém nenhum dado financeiro.
- **Acesso:** sem usuário e senha. O celular recebe uma chave secreta pelo QR code exibido no programa do PC (tela **Celular**). A chave fica só no aparelho; sem ela a nuvem não responde.
- **Instalar no Android:** abra o link do QR code no Chrome → menu ⋮ → **Instalar app** / **Adicionar à tela inicial**.

`supabase/schema.sql` é o script do banco (tabelas privadas + função `cf_api` com todas as regras de cálculo).
