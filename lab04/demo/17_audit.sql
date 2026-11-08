-- Журнал операцій: хто і що змінював (записи вебзастосунку, консолі та psql)
SELECT username, action, COUNT(*) AS operations
FROM activity_log GROUP BY username, action ORDER BY username, action;

-- Останні зміни даних зі старими і новими значеннями
SELECT log_id, to_char(created_at, 'HH24:MI:SS') AS time, username, action, table_name, record_id,
       COALESCE(details,
                (SELECT string_agg(key || ': ' || COALESCE(old_data ->> key, '-') || ' -> ' || COALESCE(value, '-'), '; ')
                 FROM jsonb_each_text(new_data)
                 WHERE old_data IS NOT NULL AND (old_data ->> key) IS DISTINCT FROM value AND key <> 'updated_at'),
                'новий запис') AS changes
FROM activity_log
ORDER BY log_id DESC
LIMIT 20;
