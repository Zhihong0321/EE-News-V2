import React, { useState, useEffect } from 'react';
import './TaskManager.css';

function TaskManager() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [runningTask, setRunningTask] = useState(null);
  const [executionLog, setExecutionLog] = useState([]);
  const [availableGems, setAvailableGems] = useState([]);
  const [loadingGems, setLoadingGems] = useState(false);
  
  const [formData, setFormData] = useState({
    name: '',
    query: '',
    gems_url: '',
    schedule: '08:00',
    is_active: true
  });

  useEffect(() => {
    fetchTasks();
    fetchAvailableGems();
  }, []);

  const fetchTasks = async () => {
    try {
      const response = await fetch('/api/tasks');
      const data = await response.json();
      if (data.success) {
        setTasks(data.tasks);
      }
    } catch (error) {
      console.error('Error fetching tasks:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchAvailableGems = async () => {
    setLoadingGems(true);
    try {
      const response = await fetch('/api/gems');
      const data = await response.json();
      console.log('GEMS API response:', data);
      if (data.success && data.gems) {
        console.log('Available GEMS:', data.gems);
        setAvailableGems(data.gems);
      } else {
        console.warn('No GEMS found or API error:', data);
      }
    } catch (error) {
      console.error('Error fetching GEMS:', error);
    } finally {
      setLoadingGems(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const url = editingTask ? `/api/tasks/${editingTask.id}` : '/api/tasks';
      const method = editingTask ? 'PUT' : 'POST';
      
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
      
      const data = await response.json();
      if (data.success) {
        await fetchTasks();
        resetForm();
      }
    } catch (error) {
      console.error('Error saving task:', error);
    }
  };

  const handleEdit = (task) => {
    setEditingTask(task);
    setFormData({
      name: task.name,
      query: task.query,
      gems_url: task.gems_url || '',
      schedule: task.schedule,
      is_active: task.is_active
    });
    setShowForm(true);
  };

  const handleDelete = async (taskId) => {
    if (!confirm('Are you sure you want to delete this task?')) return;
    
    try {
      const response = await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' });
      const data = await response.json();
      if (data.success) {
        await fetchTasks();
      }
    } catch (error) {
      console.error('Error deleting task:', error);
    }
  };

  const addLog = (message, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    setExecutionLog(prev => [...prev, { timestamp, message, type }]);
  };

  const handleManualRun = async (task) => {
    setRunningTask(task.id);
    setExecutionLog([]);
    addLog(`Starting manual execution for task: ${task.name}`, 'info');

    try {
      addLog(`Step 1: Fetching headlines for query: "${task.query}"`, 'info');
      
      const response = await fetch('/api/cron/manual-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: task.id })
      });
      
      const data = await response.json();
      
      if (data.success) {
        addLog(`✓ Execution completed successfully`, 'success');
        addLog(`Headlines fetched: ${data.stats?.headlines_fetched || 0}`, 'success');
        addLog(`Articles processed: ${data.stats?.articles_processed || 0}`, 'success');
        
        if (data.details) {
          addLog(`\nDetailed Results:`, 'info');
          data.details.forEach((detail, idx) => {
            addLog(`  ${idx + 1}. ${detail.headline}`, detail.status === 'completed' ? 'success' : 'warning');
            if (detail.error) {
              addLog(`     Error: ${detail.error}`, 'error');
            }
          });
        }
      } else {
        addLog(`✗ Execution failed: ${data.error}`, 'error');
      }
    } catch (error) {
      addLog(`✗ Fatal error: ${error.message}`, 'error');
    } finally {
      setRunningTask(null);
    }
  };

  const resetForm = () => {
    setShowForm(false);
    setEditingTask(null);
    setFormData({
      name: '',
      query: '',
      gems_url: '',
      schedule: '08:00',
      is_active: true
    });
  };


  if (loading) {
    return <div className="task-manager"><div className="loading">Loading tasks...</div></div>;
  }

  return (
    <div className="task-manager">
      <div className="task-header">
        <h1>Task Management</h1>
        <button className="btn-primary" onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Cancel' : '+ New Task'}
        </button>
      </div>

      {showForm && (
        <div className="task-form-card">
          <h2>{editingTask ? 'Edit Task' : 'Create New Task'}</h2>
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>Task Name</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({...formData, name: e.target.value})}
                placeholder="e.g., Daily Tech News"
                required
              />
            </div>
            
            <div className="form-group">
              <label>Search Query</label>
              <textarea
                value={formData.query}
                onChange={(e) => setFormData({...formData, query: e.target.value})}
                placeholder="e.g., latest technology news"
                rows="3"
                required
              />
            </div>
            
            <div className="form-group">
              <label>
                GEMS Selection
                {loadingGems && <span style={{ marginLeft: '8px', fontSize: '12px', color: '#999' }}>Loading...</span>}
              </label>
              <select
                value={formData.gems_url}
                onChange={(e) => setFormData({...formData, gems_url: e.target.value})}
                disabled={loadingGems}
              >
                <option value="">-- Select a GEMS (or use default) --</option>
                {availableGems.length === 0 && !loadingGems && (
                  <option disabled>No GEMS available</option>
                )}
                {availableGems.map((gem, idx) => (
                  <option key={idx} value={gem.url}>
                    {gem.name} {gem.description ? `- ${gem.description}` : ''}
                  </option>
                ))}
              </select>
              {formData.gems_url && (
                <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
                  Selected: {formData.gems_url}
                </div>
              )}
            </div>
            
            <div className="form-row">
              <div className="form-group">
                <label>Schedule Time</label>
                <input
                  type="time"
                  value={formData.schedule}
                  onChange={(e) => setFormData({...formData, schedule: e.target.value})}
                />
              </div>
              
              <div className="form-group">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={formData.is_active}
                    onChange={(e) => setFormData({...formData, is_active: e.target.checked})}
                  />
                  Active
                </label>
              </div>
            </div>
            
            <div className="form-actions">
              <button type="submit" className="btn-primary">
                {editingTask ? 'Update Task' : 'Create Task'}
              </button>
              <button type="button" className="btn-secondary" onClick={resetForm}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="tasks-list">
        {tasks.length === 0 ? (
          <div className="empty-state">No tasks yet. Create your first task!</div>
        ) : (
          tasks.map(task => (
            <div key={task.id} className="task-card">
              <div className="task-info">
                <h3>{task.name}</h3>
                <p className="task-query">{task.query}</p>
                <div className="task-meta">
                  <span className={`status ${task.is_active ? 'active' : 'inactive'}`}>
                    {task.is_active ? '● Active' : '○ Inactive'}
                  </span>
                  <span>Schedule: {task.schedule}</span>
                  {task.last_run_at && (
                    <span>Last run: {new Date(task.last_run_at).toLocaleString()}</span>
                  )}
                </div>
              </div>
              
              <div className="task-actions">
                <button 
                  className="btn-run" 
                  onClick={() => handleManualRun(task)}
                  disabled={runningTask === task.id}
                >
                  {runningTask === task.id ? '⏳ Running...' : '▶ Run Now'}
                </button>
                <button className="btn-edit" onClick={() => handleEdit(task)}>
                  ✎ Edit
                </button>
                <button className="btn-delete" onClick={() => handleDelete(task.id)}>
                  🗑 Delete
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {executionLog.length > 0 && (
        <div className="execution-log">
          <h2>Execution Log</h2>
          <div className="log-content">
            {executionLog.map((log, idx) => (
              <div key={idx} className={`log-entry log-${log.type}`}>
                <span className="log-time">[{log.timestamp}]</span>
                <span className="log-message">{log.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default TaskManager;
