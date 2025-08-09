from flask import Flask, jsonify, render_template
from flask_cors import CORS
import json
import requests
from datetime import datetime, timedelta
import os
from dotenv import load_dotenv

# Load Odoo credentials from environment variables
# Make sure to define these in your local .env (not committed) or your deployment environment
load_dotenv()

app = Flask(__name__)
CORS(app)

def calculate_working_days(start_date, end_date):
    """Calculate working days between two dates (excluding weekends)"""
    if start_date >= end_date:
        return 0
    
    working_days = 0
    current_date = start_date
    
    while current_date < end_date:
        # Monday is 0, Sunday is 6
        if current_date.weekday() < 5:  # Monday to Friday
            working_days += 1
        current_date += timedelta(days=1)
    
    return working_days

def calculate_calendar_days(start_date, end_date):
    """Calculate calendar days between two dates"""
    if start_date >= end_date:
        return 0
    # Calculate days difference using date objects to avoid time-based truncation
    start_date_only = start_date.date()
    end_date_only = end_date.date()
    return (end_date_only - start_date_only).days

def is_today(date_to_check, current_date):
    """Check if a date is today"""
    return date_to_check.date() == current_date.date()

def is_weekend(date_to_check):
    """Check if a date falls on weekend (Saturday=5, Sunday=6)"""
    return date_to_check.weekday() >= 5

# Odoo credentials loaded from environment variables
url = os.getenv('ODOO_URL')
db = os.getenv('ODOO_DB')
username = os.getenv('ODOO_USERNAME')
api_key = os.getenv('ODOO_API_KEY')

# Validate that all required credentials are provided
missing_vars = []
if not url:
    missing_vars.append('ODOO_URL')
if not db:
    missing_vars.append('ODOO_DB')
if not username:
    missing_vars.append('ODOO_USERNAME')
if not api_key:
    missing_vars.append('ODOO_API_KEY')

if missing_vars:
    raise ValueError(f"Missing required environment variables: {', '.join(missing_vars)}")

# JSON-RPC helper (copied from tasks.py without modification)
def json_rpc(endpoint, method, params):
    headers = {'Content-Type': 'application/json'}
    payload = {
        "jsonrpc": "2.0",
        "method": "call",
        "params": params,
        "id": 1,
    }

    response = requests.post(endpoint, data=json.dumps(payload), headers=headers)
    try:
        response.raise_for_status()
        data = response.json()

        if 'error' in data:
            print("❌ JSON-RPC Error:")
            print(json.dumps(data['error'], indent=2))
            raise Exception("JSON-RPC call failed.")

        return data['result']
    except requests.HTTPError as e:
        print("❌ HTTP Error:", e)
        print("Response content:", response.text)
        raise
    except ValueError:
        print("❌ Failed to decode JSON:")
        print(response.text)
        raise

def get_tasks_data():
    """Get tasks data using the same logic as tasks.py but return structured data"""
    try:
        # Step 1: Authenticate
        uid = json_rpc(
            url,
            "call",
            {
                "service": "common",
                "method": "authenticate",
                "args": [db, username, api_key, {}],
            }
        )

        if not uid:
            raise Exception("Failed to authenticate")

        # Step 2: Fetch tasks with deadlines and projects (exclude tasks without projects)
        tasks = json_rpc(
            url,
            "call",
            {
                "service": "object",
                "method": "execute_kw",
                "args": [
                    db,
                    uid,
                    api_key,
                    "project.task",
                    "search_read",
                    [[["date_deadline", "!=", False], ["project_id", "!=", False]]],
                    {
                        "fields": ["id", "name", "project_id", "stage_id", "date_deadline", "user_ids", "state", "is_closed"],
                        "limit": 1000,
                    }
                ]
            }
        )


        # Step 3: Get unique project IDs, user IDs, and task stage IDs
        project_ids = set()
        user_ids = set()
        task_stage_ids = set()

        for task in tasks:
            if task['project_id']:
                project_ids.add(task['project_id'][0])
            if task['user_ids']:
                user_ids.update(task['user_ids'])
            if task['stage_id']:
                task_stage_ids.add(task['stage_id'][0])

        # Step 4: Fetch projects and their managers
        projects = json_rpc(
            url,
            "call",
            {
                "service": "object",
                "method": "execute_kw",
                "args": [
                    db,
                    uid,
                    api_key,
                    "project.project",
                    "read",
                    [list(project_ids)],
                    {"fields": ["id", "name", "user_id", "stage_id"]}
                ]
            }
        )

        # Step 5: Fetch user names
        users = json_rpc(
            url,
            "call",
            {
                "service": "object",
                "method": "execute_kw",
                "args": [
                    db,
                    uid,
                    api_key,
                    "res.users",
                    "read",
                    [list(user_ids)],
                    {"fields": ["id", "name"]}
                ]
            }
        )

        # Step 6: Fetch task stage names
        task_stages = json_rpc(
            url,
            "call",
            {
                "service": "object",
                "method": "execute_kw",
                "args": [
                    db,
                    uid,
                    api_key,
                    "project.task.type",
                    "read",
                    [list(task_stage_ids)],
                    {"fields": ["id", "name"]}
                ]
            }
        )

        # Step 6b: Get project stage IDs from projects and fetch project stages
        project_stage_ids = set()
        for proj in projects:
            if proj.get('stage_id'):
                project_stage_ids.add(proj['stage_id'][0])

        project_stages = []
        if project_stage_ids:
            project_stages = json_rpc(
                url,
                "call",
                {
                    "service": "object",
                    "method": "execute_kw",
                    "args": [
                        db,
                        uid,
                        api_key,
                        "project.project.stage",
                        "read",
                        [list(project_stage_ids)],
                        {"fields": ["id", "name"]}
                    ]
                }
            )

        # Step 7: Build lookup maps
        project_managers = {
            proj['id']: proj['user_id'][1] if proj['user_id'] else "No Manager"
            for proj in projects
        }

        project_names = {
            proj['id']: proj['name']
            for proj in projects
        }

        user_names = {
            user['id']: user['name']
            for user in users
        }

        task_stage_names = {
            stage['id']: stage['name']
            for stage in task_stages
        }

        project_stage_names = {
            stage['id']: stage['name']
            for stage in project_stages
        }

        # Create project to project stage mapping
        project_stage_mapping = {
            proj['id']: proj.get('stage_id')[0] if proj.get('stage_id') else None
            for proj in projects
        }

        # Step 8: Process tasks and calculate statistics
        processed_tasks = []
        done_count = 0
        overdue_count = 0
        cancelled_count = 0
        current_time = datetime.now()

        for task in tasks:
            project_id = task['project_id'][0] if task['project_id'] else None
            project_name = project_names.get(project_id, 'No Project')
            manager = project_managers.get(project_id, "Unknown")
            task_stage_id = task['stage_id'][0] if task['stage_id'] else None
            task_stage_name = task_stage_names.get(task_stage_id, 'No Stage')
            
            # Get project stage information
            project_stage_id = project_stage_mapping.get(project_id)
            project_stage_name = project_stage_names.get(project_stage_id, 'No Project Stage')
            
            deadline = task['date_deadline']
            assignees = [user_names.get(uid, f"User {uid}") for uid in task['user_ids']]
            
            # Determine if task is done or cancelled based on is_closed field and state
            task_state = task.get("state")
            is_done = task.get("is_closed") == True
            is_cancelled = task_state == "1_canceled"

            # Optionally map for user-friendly display
            task_state_label = {
                "01_in_progress": "In Progress",
                "02_changes_requested": "Changes Requested",
                "03_approved": "Approved",
                "1_canceled": "Cancelled",
                "1_done": "Done",
                "04_waiting_normal": "Waiting"
            }.get(task_state, "Unknown")
            
            # Calculate if overdue and by how much
            deadline_dt = datetime.fromisoformat(deadline.replace('Z', '+00:00')) if deadline else None
            is_overdue = False
            days_overdue = 0
            calendar_days_to_deadline = 0
            working_days_to_deadline = 0
            is_deadline_today = False
            is_deadline_weekend = False
            
            if deadline_dt:
                is_deadline_today = is_today(deadline_dt, current_time)
                is_deadline_weekend = is_weekend(deadline_dt)
                
                if not is_done and not is_cancelled:
                    if deadline_dt.date() < current_time.date():
                        is_overdue = True
                        days_overdue = (current_time.date() - deadline_dt.date()).days
                    else:
                        # For future deadlines, calculate days to deadline
                        calendar_days_to_deadline = calculate_calendar_days(current_time, deadline_dt)
                        working_days_to_deadline = calculate_working_days(current_time, deadline_dt)

            # Count statistics
            if is_done:
                done_count += 1
            elif is_cancelled:
                cancelled_count += 1
            elif is_overdue:
                overdue_count += 1

            processed_task = {
                'id': task['id'],
                'name': task['name'],
                'project_name': project_name,
                'manager': manager,
                'stage_id': task_stage_id,
                'stage_name': task_stage_name,
                'project_stage_id': project_stage_id,
                'project_stage_name': project_stage_name,
                'deadline': deadline,
                'assignees': assignees,
                'is_done': is_done,
                'is_cancelled': is_cancelled,
                'is_overdue': is_overdue,
                'days_overdue': days_overdue,
                'calendar_days_to_deadline': calendar_days_to_deadline,
                'working_days_to_deadline': working_days_to_deadline,
                'is_deadline_today': is_deadline_today,
                'is_deadline_weekend': is_deadline_weekend,
                'task_state': task_state,
                'task_state_label': task_state_label
            }
            processed_tasks.append(processed_task)

        # Step 9: Calculate project stage-based statistics
        stage_stats = {}
        for task in processed_tasks:
            project_stage_name = task['project_stage_name']
            if project_stage_name not in stage_stats:
                stage_stats[project_stage_name] = {
                    'total': 0,
                    'done': 0,
                    'overdue': 0,
                    'in_progress': 0,
                    'cancelled': 0
                }
            
            stage_stats[project_stage_name]['total'] += 1
            
            if task['is_done']:
                stage_stats[project_stage_name]['done'] += 1
            elif task['is_cancelled']:
                stage_stats[project_stage_name]['cancelled'] += 1
            elif task['is_overdue']:
                stage_stats[project_stage_name]['overdue'] += 1
            else:
                stage_stats[project_stage_name]['in_progress'] += 1

        # Calculate percentages for each stage
        stage_percentages = {}
        for stage_name, stats in stage_stats.items():
            if stats['total'] > 0:
                stage_percentages[stage_name] = {
                    'total': stats['total'],
                    'done_percentage': round((stats['done'] / stats['total']) * 100, 1),
                    'overdue_percentage': round((stats['overdue'] / stats['total']) * 100, 1),
                    'in_progress_percentage': round((stats['in_progress'] / stats['total']) * 100, 1),
                    'cancelled_percentage': round((stats['cancelled'] / stats['total']) * 100, 1),
                    'done_count': stats['done'],
                    'overdue_count': stats['overdue'],
                    'in_progress_count': stats['in_progress'],
                    'cancelled_count': stats['cancelled']
                }

        return {
            'tasks': processed_tasks,
            'statistics': {
                'total': len(processed_tasks),
                'done': done_count,
                'cancelled': cancelled_count,
                'overdue': overdue_count,
                'in_progress': len(processed_tasks) - done_count - cancelled_count - overdue_count
            },
            'stage_statistics': stage_percentages
        }

    except Exception as e:
        print(f"Error fetching tasks: {e}")
        return {
            'tasks': [],
            'statistics': {
                'total': 0,
                'done': 0,
                'cancelled': 0,
                'overdue': 0,
                'in_progress': 0
            },
            'stage_statistics': {},
            'error': str(e)
        }

@app.route('/')
def dashboard():
    """Serve the dashboard HTML"""
    return render_template('dashboard.html')

@app.route('/api/tasks')
def get_tasks():
    """API endpoint to get tasks data"""
    data = get_tasks_data()
    return jsonify(data)

if __name__ == '__main__':
    # Create templates directory if it doesn't exist
    os.makedirs('templates', exist_ok=True)
    os.makedirs('static', exist_ok=True)
    app.run(debug=True, host='0.0.0.0', port=5001)