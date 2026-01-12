import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../utils/api';

export default function Register() {
    const [formData, setFormData] = useState({
        username: '',
        email: '',
        password: '',
        phone_num: ''
    });
    const { login } = useAuth();
    const navigate = useNavigate();
    const [error, setError] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            const data = await api.auth.register(formData);
            login(data.user);
            navigate('/groups');
        } catch (err: any) {
            setError(err.message || 'Registration failed');
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50">
            <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-100 w-full max-w-md">
                <h1 className="text-2xl font-bold text-center mb-6">Join Face<span className="text-teal-500">O</span></h1>

                {error && <div className="bg-red-50 text-red-600 p-3 rounded-lg mb-4 text-sm">{error}</div>}

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Username</label>
                        <input
                            type="text" required
                            className="w-full border border-slate-300 rounded-lg p-2 focus:ring-2 focus:ring-teal-500 outline-none"
                            onChange={e => setFormData({ ...formData, username: e.target.value })}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
                        <input
                            type="email" required
                            className="w-full border border-slate-300 rounded-lg p-2 focus:ring-2 focus:ring-teal-500 outline-none"
                            onChange={e => setFormData({ ...formData, email: e.target.value })}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
                        <input
                            type="password" required
                            className="w-full border border-slate-300 rounded-lg p-2 focus:ring-2 focus:ring-teal-500 outline-none"
                            onChange={e => setFormData({ ...formData, password: e.target.value })}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Phone (Optional)</label>
                        <input
                            type="tel"
                            className="w-full border border-slate-300 rounded-lg p-2 focus:ring-2 focus:ring-teal-500 outline-none"
                            onChange={e => setFormData({ ...formData, phone_num: e.target.value })}
                        />
                    </div>
                    <button type="submit" className="w-full bg-teal-600 text-white p-3 rounded-lg font-bold hover:bg-teal-700 transition">
                        Create Account
                    </button>
                </form>
            </div>
        </div>
    );
}