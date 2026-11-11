-- PostgreSQL demande une validation de transaction avant de référencer le nouveau rôle.
alter type public.user_role add value if not exists 'administratif';
