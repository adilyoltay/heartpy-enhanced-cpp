import inspect
import heartpy.datautils as du
print(du.__file__)
print('--- rolling_mean ---')
print(inspect.getsource(du.rolling_mean))
print('--- _sliding_window ---')
print(inspect.getsource(du._sliding_window))
